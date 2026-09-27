<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import TextAlign from '@tiptap/extension-text-align';
import { BorderedTable } from '../lib/tiptap-table.ts';
import PageHead from '../components/PageHead.vue';
import EditorBlockDrawer from '../components/EditorBlockDrawer.vue';
import EditorBorderMenu from '../components/EditorBorderMenu.vue';
import { bordersFromSpec, specFromBorders, type TableBorder } from '../lib/table-borders.ts';
import { createLowlight, common } from 'lowlight';
const lowlight = createLowlight(common);
import { mdToHtml } from '../lib/marked-blocks.ts';
import EditorSourcePane from '../components/EditorSourcePane.vue';
import EditorToolbar from '../components/EditorToolbar.vue';
import { api, download } from '../api';
import { authState } from '../store/auth';
import type { AuthorOption, Collection } from '../types';
import EditorMetaPanel from '../components/EditorMetaPanel.vue';
import VersionPanel from '../components/VersionPanel.vue';
import MediaPickerModal from '../components/MediaPickerModal.vue';
import { createTurndown, checkContentRisk } from '../lib/editor';
import { PrBlock } from '../lib/tiptap-blocks.ts';
import { findBlock } from '../lib/blocks.ts';
import { parseId } from '../lib/format';
import { clearDraft, loadDraft, markTabActivity, saveDraft, listenTabActivity, type DraftSnapshot } from '../lib/drafts';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();
const route = useRoute();
const router = useRouter();

const collections = ref<Collection[]>([]);
const suggestions = ref<string[]>([]);
const loading = ref(true);
const saving = ref(false);
const uploading = ref(false);
const generatingSummary = ref(false);
const promptTemplates = ref<Array<{ id: string; name: string }>>([]);
const selectedPromptId = ref('overview');

const loadedId = ref<number | null>(null);
const baseVersion = ref(0);

const isEdit = computed(() => loadedId.value !== null);

const form = reactive({
  title: '',
  slug: '',
  collection_id: null as number | null,
  summary: '',
  cover_url: '',
  meta_keywords: '',
  is_pinned: 0,
  scheduled_enabled: false,
  scheduled_local: '',
  status: 'draft' as 'draft' | 'published',
  version_message: '',
  tags: [] as string[],
  inherited_tags: [] as string[],
  /** 署名作者，顺序即展示顺序，第一位为主作者 */
  author_ids: [] as number[],
  /** 全文排版预设：'' = 主题默认，可选 wechat/magazine/warm */
  layout: '' as string,
});

// 文集切换时跟随该文集的默认 AI 提示词。必须放在 form 声明之后：
// watch 会立刻执行 getter，提前引用 form 会抛 TDZ（静默失效且控制台报错）。
watch(() => form.collection_id, async (colId) => {
  if (colId == null) return;
  try {
    const { collection } = await api.collection(colId);
    selectedPromptId.value = (collection as any).ai_prompt_id ?? 'overview';
  } catch { /* ignore */ }
});

// 可选作者名单：作者与管理员都可读，含各自已发布篇数
const authorOptions = ref<AuthorOption[]>([]);

// ---- 排版块（公众号式排版素材） ----
const showBlockDrawer = ref(false);
const blkTick = ref(0); // 选区变化时触发重算

/** 当前光标所在的排版块（有则显示属性浮条） */
const activeBlk = computed<{ block: string; variant: string } | null>(() => {
  blkTick.value; // 依赖选区版本号
  const ed = editor.value;
  if (!ed) return null;
  for (const name of ['prBlock']) {
    if (ed.isActive(name)) {
      const attrs = ed.getAttributes(name) as { block?: string; variant?: string };
      return { block: String(attrs.block ?? 'callout'), variant: String(attrs.variant ?? '') };
    }
  }
  return null;
});

const activeBlkVariantOptions = computed(() => findBlock(activeBlk.value?.block ?? '')?.variants ?? []);

/** 插入排版块：素材抽屉点一下就进来，并选中占位文字便于直接改写 */
const BLK_PLACEHOLDER = '在这里写内容';

function insertBlk(name: string): void {
  const def = findBlock(name);
  const ed = editor.value;
  if (!def || !ed) return;
  const variant = def.variants[0]?.value ?? '';
  // 一次性把块与占位段落插入（分两步会让文字落到块外）
  ed.chain().focus().insertPrBlock({ block: name, variant }, def.empty ? '' : BLK_PLACEHOLDER).run();
  if (!def.empty) {
    // 选中占位文字：新手点一下就插入，直接打字即可覆盖
    const end = ed.state.selection.from;
    ed.chain().focus().setTextSelection({ from: end - BLK_PLACEHOLDER.length, to: end }).run();
  }
  // 插入后收起抽屉：避免浮层盖住属性浮条，也让新手看清刚插入的块
  showBlockDrawer.value = false;
  blkTick.value++;
}
// 作者视角的文集可写性：私有且未协作的文集在下拉里禁用，避免选完才吃 403
const colWritable = ref<Map<number, boolean>>(new Map());

function canWriteCollection(id: number | null): boolean {
  if (id === null) return true;
  return colWritable.value.get(id) !== false;
}
const coverFileInput = ref<HTMLInputElement | null>(null);
const imageFileInput = ref<HTMLInputElement | null>(null);

// 编辑器不支持的结构提示：加载/保存时检测 markdown 表格与块级 HTML，避免往返后静默丢失
const contentRisk = ref('');

const turndown = createTurndown();

/** 工具条的「可视化 / 源码」切换：子组件只报意图，切换动作留在父组件（涉及编辑器与草稿状态） */
function onSwitchMode(next: 'wysiwyg' | 'source'): void {
  if (next === 'source') switchToSource();
  else switchToWysiwyg();
}

// ---- 表格框线（Excel 式逐边开关）----
const showBorderMenu = ref(false);
/**
 * 当前表格的框线边集合。用函数而非 computed：编辑器状态不是 Vue 响应式源，
 * computed 会被缓存导致连续点选时读到旧值；模板里每次渲染重新取才跟手。
 */
function currentBorders(): TableBorder[] {
  if (!editor.value?.isActive('table')) return [];
  return bordersFromSpec(editor.value.getAttributes('table').borders);
}
function applyBorderSpec(spec: string): void {
  editor.value?.chain().focus().updateAttributes('table', { borders: spec }).run();
}
function applyBordersPreset(value: string): void {
  applyBorderSpec(value === 'all' ? '' : value);
}
function toggleBorder(b: TableBorder): void {
  const set = new Set(currentBorders());
  if (set.has(b)) set.delete(b);
  else set.add(b);
  applyBorderSpec(specFromBorders([...set]));
}

const uploadingKeys = new Set<string>();

// 署名作者的选择与排序逻辑随表单一并移到 EditorMetaPanel.vue


function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

async function uploadImage(file: File) {
  if (!file.type.startsWith('image/')) {
    emit('notify', '仅支持图片文件', true);
    return;
  }
  const key = fileKey(file);
  if (uploadingKeys.has(key)) return;
  uploadingKeys.add(key);
  uploading.value = true;
  try {
    const { url } = await api.upload(file);
    editor.value?.chain().focus().setImage({ src: url }).run();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    uploadingKeys.delete(key);
    uploading.value = false;
  }
}

function filesFromEvent(e: ClipboardEvent | DragEvent): File[] {
  const items = e instanceof ClipboardEvent ? Array.from(e.clipboardData?.items ?? []) : [];
  const files = items.length > 0 ? items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()) : Array.from((e as DragEvent).dataTransfer?.files ?? []);
  return files.filter((f): f is File => f instanceof File && f.type.startsWith('image/'));
}

const editor = useEditor({
  content: '',
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    Link.configure({ openOnClick: false, autolink: true }),
    Image,
    Placeholder.configure({ placeholder: '落笔于此，墨韵自生……' }),
    BorderedTable.configure({ resizable: true, HTMLAttributes: { class: 'tip-table' } }),    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight }),
    TextAlign.configure({ types: ['heading', 'paragraph', 'tableCell', 'tableHeader'] }),
    PrBlock,
  ],
  editorProps: {
    handlePaste(view, event) {
      const files = filesFromEvent(event);
      if (files.length === 0) return false;
      files.forEach((f) => void uploadImage(f));
      return true;
    },
    handleDrop(view, event) {
      const files = filesFromEvent(event);
      if (files.length === 0) return false;
      files.forEach((f) => void uploadImage(f));
      return true;
    },
  },
  // 选区变化时刷新「块属性浮条」（是否在排版块内、哪个变体）
  onSelectionUpdate() {
    blkTick.value++;
  },
});

// ---- 源码模式：CodeMirror 编辑 + 实时预览（对外是 EditorSourcePane 组件）----
const mode = ref<'wysiwyg' | 'source'>('wysiwyg');
const sourceMarkdown = ref('');
const sourcePane = ref<InstanceType<typeof EditorSourcePane> | null>(null);

/** 源码模式的 CodeMirror 实例在 EditorSourcePane 内维护；父组件只负责切换与转调 */
function switchToSource() {
  if (mode.value === 'source') return;
  sourceMarkdown.value = currentMarkdown();
  mode.value = 'source';
}

function switchToWysiwyg() {
  if (mode.value === 'wysiwyg') return;
  if (editor.value) editor.value.commands.setContent(mdToHtml(sourceMarkdown.value));
  contentRisk.value = checkContentRisk(sourceMarkdown.value);
  mode.value = 'wysiwyg';
}

function insertSnippet(before: string, after = '', placeholder = ''): void {
  sourcePane.value?.insertSnippet(before, after, placeholder);
}

function insertBlock(block: string) {
  sourcePane.value?.insertBlock(block);
}

function currentMarkdown(): string {
  if (mode.value === 'source') return sourceMarkdown.value;
  return turndown.turndown(editor.value?.getHTML() ?? '');
}

async function load() {
  if (collections.value.length === 0) {
    if (authState.role === 'admin') {
      const cols = await api.collections();
      collections.value = cols.collections;
    } else {
      // 作者：取带可写性的视图，别人的私有文集在下拉里禁用并标注
      const view = await api.collectionView();
      collections.value = view.collections as unknown as Collection[];
      colWritable.value = new Map(view.collections.map((c) => [c.id, c.can_write]));
    }
  }
  // 署名候选名单：读取失败不阻塞写作，选择器会退回 #id 占位
  try {
    const r = await api.authors();
    authorOptions.value = r.authors;
  } catch { /* 待下次保存/刷新重试 */ }
  // 载入 prompt 模板并确定默认选择
  try {
    const s = await api.settings() as unknown as Record<string, string>;
    const raw = s.ai_prompt_templates;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) promptTemplates.value = parsed.filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string');
    }
  } catch { /* ignore */ }

  const id = parseId(route.query.id);
  loadedId.value = id;
  baseVersion.value = 0;
  form.version_message = '';
  if (id) {
    const { post, tags, version } = await api.post(id);
    baseVersion.value = version;
    form.title = post.title;
    form.slug = post.slug;
    form.collection_id = post.collection_id;
    form.summary = post.summary;
    form.cover_url = post.cover_url;
    form.meta_keywords = post.meta_keywords ?? '';
    form.is_pinned = post.is_pinned ?? 0;
    form.scheduled_enabled = !!post.scheduled_at;
    form.scheduled_local = post.scheduled_at ? toLocalInputValue(post.scheduled_at) : '';
    form.status = post.status;
    form.tags = tags.map((t) => t.name);
    form.author_ids = (post.authors ?? []).map((a) => a.id);
    form.layout = post.layout ?? '';
    contentRisk.value = checkContentRisk(post.content_md);
    if (editor.value) editor.value.commands.setContent(mdToHtml(post.content_md));
    await maybeRestoreDraft(`post:${id}`, id, version, post.content_md);
  } else {
    form.title = '';
    form.slug = '';
    form.collection_id = null;
    form.summary = '';
    form.cover_url = '';
    form.meta_keywords = '';
    form.is_pinned = 0;
    form.scheduled_enabled = false;
    form.scheduled_local = '';
    form.status = 'draft';
    form.version_message = '';
    form.tags = [];
    form.inherited_tags = [];
    // 新篇默认署名自己，与服务端缺省一致（避免保存前后署名显示不一致）
    form.author_ids = authState.userId > 0 ? [authState.userId] : [];
    form.layout = '';
    const cid = parseId(route.query.collection);
    if (cid && collections.value.some((c) => c.id === cid) && canWriteCollection(cid)) form.collection_id = cid;
    contentRisk.value = '';
    if (editor.value) editor.value.commands.setContent('');
    await maybeRestoreDraft(newDraftKey(), null, 0, '');
  }
  // 加载/恢复完成后以当前状态为基线：内容未变时不产生重复快照
  dirtyDraft.value = false;
  lastSnapshotJson = snapshotJson();
}

async function afterVersionRestore() {
  // 回滚版本后服务器即为最新真相：清掉旧快照，避免"服务器已更新"误报
  if (draftKey.value) await clearDraft(draftKey.value).catch(() => {});
  await load();
}

// ---- 本地草稿自动保存（IndexedDB）：内容变更后 2 秒写入；服务器保存成功才清除 ----

const draftKey = ref<string | null>(null);
const dirtyDraft = ref(false);
const autosaveTimer = ref<number | null>(null);
let unsubscribeTab: (() => void) | null = null;
let lastSnapshotJson = '';
const AUTOSAVE_DEBOUNCE_MS = 2000;

// 定时发布：scheduled_at 统一按 UTC ISO 存储；datetime-local 用浏览器本地时区展示
function scheduledIso(): string {
  return form.scheduled_enabled && form.scheduled_local ? new Date(form.scheduled_local).toISOString() : '';
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 新建草稿的临时键：sessionStorage 记录当前标签页正在写的新稿键，
// 刷新/重开后沿用同一键，不会与另一篇新稿混在一起
const NEW_KEY_SESSION = 'draft-new-key';

function newDraftKey(): string {
  try {
    const existing = sessionStorage.getItem(NEW_KEY_SESSION);
    if (existing && existing.startsWith('new:')) return existing;
    const key = `new:${crypto.randomUUID()}`;
    sessionStorage.setItem(NEW_KEY_SESSION, key);
    return key;
  } catch {
    return `new:${crypto.randomUUID()}`;
  }
}

function currentSnapshot(): DraftSnapshot {
  return {
    key: draftKey.value ?? '',
    post_id: loadedId.value,
    title: form.title,
    slug: form.slug,
    collection_id: form.collection_id,
summary: form.summary,
    cover_url: form.cover_url,
    meta_keywords: form.meta_keywords,
    is_pinned: form.is_pinned,
    scheduled_at: scheduledIso(),
    status: form.status,
    tags: [...form.tags],
    author_ids: [...form.author_ids],
    layout: form.layout,
    content_md: currentMarkdown(),
    base_version: baseVersion.value,
    saved_at: new Date().toISOString(),
  };
}

function snapshotJson(): string {
  return JSON.stringify(currentSnapshot());
}

async function writeAutosave(): Promise<void> {
  autosaveTimer.value = null;
  if (!draftKey.value || !dirtyDraft.value) return;
  const result = await saveDraft(currentSnapshot());
  if (result.ok) {
    markTabActivity(draftKey.value);
  } else {
    // 空间不足等：只提示一次，不反复打扰
    if (!quotaWarned.value) {
      quotaWarned.value = true;
      emit('notify', result.error, true);
    }
  }
}

const quotaWarned = ref(false);

function scheduleAutosave(): void {
  // 与上次已落盘内容一致时不重复写（加载/恢复后表单与快照相同的情况）
  const j = snapshotJson();
  if (j === lastSnapshotJson) return;
  lastSnapshotJson = j;
  dirtyDraft.value = true;
  quotaWarned.value = false;
  if (autosaveTimer.value !== null) window.clearTimeout(autosaveTimer.value);
  autosaveTimer.value = window.setTimeout(() => void writeAutosave(), AUTOSAVE_DEBOUNCE_MS);
}

function flushAutosave(): void {
  if (autosaveTimer.value !== null) {
    window.clearTimeout(autosaveTimer.value);
    autosaveTimer.value = null;
  }
  if (dirtyDraft.value && draftKey.value) void writeAutosave();
}

// 打开编辑器时读取本地快照并与服务端比较：
// - 基线相同且有未保存内容：询问恢复；
// - 基线已过期：明确告知"服务器已更新"，由用户决定覆盖或保留服务器；
// - 没有快照：正常打开。
async function maybeRestoreDraft(key: string, postId: number | null, serverVersion: number, serverContent: string): Promise<void> {
  draftKey.value = key;
  const snapshot = await loadDraft(key).catch(() => null);
  if (!snapshot) return;

  if (postId === null) {
    if (confirm(`检测到未保存的新稿（保存于 ${snapshot.saved_at.slice(0, 16).replace('T', ' ')}）。恢复继续写？`)) {
      applySnapshot(snapshot);
    } else {
      await clearDraft(key);
    }
    return;
  }

  const localDiffers = snapshot.content_md !== serverContent ||
    snapshot.title !== form.title || snapshot.slug !== form.slug ||
    snapshot.collection_id !== form.collection_id || snapshot.summary !== form.summary ||
    snapshot.cover_url !== form.cover_url || snapshot.status !== form.status ||
    snapshot.meta_keywords !== form.meta_keywords || snapshot.is_pinned !== form.is_pinned ||
    snapshot.scheduled_at !== scheduledIso() ||
    (snapshot.author_ids ?? []).join(',') !== form.author_ids.join(',') ||
    (snapshot.layout ?? '') !== form.layout ||
    snapshot.tags.join('\u0001') !== form.tags.join('\u0001');
  if (!localDiffers) {
    await clearDraft(key);
    return;
  }

  if (snapshot.base_version === serverVersion) {
    if (confirm(`检测到未保存的本地修改（保存于 ${snapshot.saved_at.slice(0, 16).replace('T', ' ')}）。恢复本地内容？`)) {
      applySnapshot(snapshot);
    } else {
      await clearDraft(key);
    }
  } else {
    const useLocal = confirm(
      `服务器上本篇已有更新（本地快照基于 v${snapshot.base_version}，服务器为 v${serverVersion}）。\n\n确定：用本地快照覆盖（保存时仍按服务器最新版本提交，冲突会收到提示）\n取消：保留服务器内容，丢弃本地快照`,
    );
    if (useLocal) {
      applySnapshot(snapshot);
    } else {
      await clearDraft(key);
    }
  }
}

function applySnapshot(s: DraftSnapshot): void {
  form.title = s.title;
  form.slug = s.slug;
  form.collection_id = s.collection_id;
  form.summary = s.summary;
  form.cover_url = s.cover_url;
  form.meta_keywords = s.meta_keywords;
  form.is_pinned = s.is_pinned;
  form.scheduled_enabled = !!s.scheduled_at;
  form.scheduled_local = s.scheduled_at ? toLocalInputValue(s.scheduled_at) : '';
  form.status = s.status;
  form.tags = [...s.tags];
  form.author_ids = [...(s.author_ids ?? [])];
  form.layout = s.layout ?? '';
  contentRisk.value = checkContentRisk(s.content_md);
  if (editor.value) editor.value.commands.setContent(mdToHtml(s.content_md));
}

// 内容变更（表单字段 + 编辑器）→ 防抖自动保存
watch(
  () => ({
    title: form.title,
    slug: form.slug,
    collection_id: form.collection_id,
    summary: form.summary,
    cover_url: form.cover_url,
    meta_keywords: form.meta_keywords,
    is_pinned: form.is_pinned,
    scheduled_enabled: form.scheduled_enabled,
    scheduled_local: form.scheduled_local,
    status: form.status,
    tags: [...form.tags],
    author_ids: [...form.author_ids],
    html: editor.value?.getHTML() ?? '',
    source: mode.value === 'source' ? sourceMarkdown.value : '',
  }),
  () => {
    if (loading.value || draftKey.value === null) return;
    scheduleAutosave();
  },
  { deep: true },
);

// 多标签页同文编辑提示（尽力而为，不宣称解决并发）
watch(draftKey, (key) => {
  unsubscribeTab?.();
  unsubscribeTab = null;
  if (!key) return;
  markTabActivity(key);
  unsubscribeTab = listenTabActivity(key, () => {
    emit('notify', '另一标签页也在编辑本篇，保存前请注意服务器冲突提示', true);
  });
});

onBeforeUnmount(() => {
  editor.value?.destroy();
  unsubscribeTab?.();
  flushAutosave();
});

// 页面隐藏/刷新前落一次盘
window.addEventListener('pagehide', flushAutosave);

// 文集切换时刷新继承标签提示
watch(
  () => form.collection_id,
  async (id) => {
    if (id == null) {
      form.inherited_tags = [];
      return;
    }
    try {
      const { tags } = await api.collection(id);
      form.inherited_tags = tags.map((t) => t.name);
    } catch {
      form.inherited_tags = [];
    }
  },
);

watch(() => [route.query.id, route.query.collection] as const, async ([id, collection]) => {
  if (loading.value) return;
  const next = parseId(id);
  if (next !== null && next === loadedId.value) return;
  // 切换篇目前先落一次盘，避免挂起的防抖把旧键内容写进新键
  flushAutosave();
  loading.value = true;
  try {
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    loading.value = false;
  }
});

onMounted(() => {
  void load().catch((e) => emit('notify', (e as Error).message, true)).finally(() => (loading.value = false));
  api.tags().then((r) => (suggestions.value = r.tags.map((t) => t.name))).catch(() => {});
});

async function save() {
  if (!form.title.trim()) return emit('notify', '篇名不可为空', true);
  if (!editor.value) return;
  saving.value = true;
  try {
    const content_md = currentMarkdown();
    contentRisk.value = checkContentRisk(content_md);
    const payload = {
      title: form.title.trim(),
      slug: form.slug,
      collection_id: form.collection_id,
      summary: form.summary,
      cover_url: form.cover_url,
      meta_keywords: form.meta_keywords,
      is_pinned: form.is_pinned,
      scheduled_at: scheduledIso(),
      content_md,
      status: form.status,
      version_message: form.version_message.trim(),
      tags: form.tags,
      authors: form.author_ids,
      layout: form.layout,
      base_version: baseVersion.value,
    };
    if (loadedId.value !== null) {
      const { version, tags } = await api.updatePost(loadedId.value, payload);
      baseVersion.value = version;
      // 以服务端归一化结果回填（去重、空白归一化），与数据库保持一致
      form.tags = tags.map((t) => t.name);
      emit('notify', '篇章已存');
      form.version_message = '';
      // 保存成功才清除本地快照；失败/409 时保留，等待下次变更重新写入
      if (draftKey.value) {
        await clearDraft(draftKey.value).catch(() => {});
        dirtyDraft.value = false;
        lastSnapshotJson = snapshotJson();
      }
    } else {
      const { post, tags, version } = await api.createPost(payload);
      baseVersion.value = version;
      form.tags = tags.map((t) => t.name);
      emit('notify', '新篇已成');
      // 新稿快照作废，转入 post:{id} 键；服务端为最新真相，先清掉旧快照再重新自动保存
      if (draftKey.value) {
        await clearDraft(draftKey.value).catch(() => {});
      }
      sessionStorage.removeItem(NEW_KEY_SESSION);
      draftKey.value = `post:${post.id}`;
      dirtyDraft.value = false;
      lastSnapshotJson = '';
      router.replace({ path: '/editor', query: { id: post.id } });
      loadedId.value = post.id;
    }
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function uploadCover(file: File) {
  try {
    const { url } = await api.upload(file);
    form.cover_url = url;
    emit('notify', '封面已传');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

function onCoverPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) uploadCover(file);
}

function onImagePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void uploadImage(file);
}

function setLink() {
  if (!editor.value) return;
  const prev = editor.value.getAttributes('link').href as string | undefined;
  const url = prompt('链接地址', prev ?? 'https://');
  if (url === null) return;
  if (!url) {
    editor.value.chain().focus().unsetLink().run();
    return;
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

const showPicker = ref(false);

function openPicker() {
  showPicker.value = true;
}

function insertMedia(url: string) {
  editor.value?.chain().focus().setImage({ src: url }).run();
  showPicker.value = false;
}

const showVersions = ref(false);

function openVersions() {
  if (loadedId.value === null) return;
  showVersions.value = true;
}

const exporting = ref(false);

async function exportMarkdown() {
  if (loadedId.value === null) return;
  exporting.value = true;
  try {
    await download(`/api/export/posts/${loadedId.value}.md`, `post-${loadedId.value}.md`);
    emit('notify', 'Markdown 已导出');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    exporting.value = false;
  }
}

async function generateAiSummary() {
  if (generatingSummary.value) return;
  const md = currentMarkdown();
  if (!md.trim()) {
    emit('notify', '正文为空，无法生成摘要', true);
    return;
  }
  generatingSummary.value = true;
  try {
    const res = await api.aiSummary(md, form.collection_id ?? undefined, loadedId.value ?? undefined, selectedPromptId.value);
    if (res.summaries && res.summaries.length > 0) {
      if (res.summaries.length === 1) {
        form.summary = res.summaries[0];
        emit('notify', 'AI 摘要已生成');
      } else {
        // 多候选：弹出选择
        const chosen = res.summaries;
        form.summary = chosen[0];
        emit('notify', `已生成 ${chosen.length} 条候选，使用第一条`);
      }
    } else {
      emit('notify', 'AI 未生成有效摘要', true);
    }
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    generatingSummary.value = false;
  }
}
</script>

<template>
  <PageHead :kicker="isEdit ? '改 篇' : '新 篇'" :title="isEdit ? '修改篇章' : '写下新篇'" />

  <div v-if="!loading" class="card pad">
    <form @submit.prevent="save">
      <EditorMetaPanel
        :form="form"
        :collections="collections"
        :author-options="authorOptions"
        :suggestions="suggestions"
        :prompt-templates="promptTemplates"
        :selected-prompt-id="selectedPromptId"
        :generating-summary="generatingSummary"
        :uploading="uploading"
        :can-write="canWriteCollection"
        @generate-summary="generateAiSummary"
        @pick-cover="coverFileInput?.click()"
        @notify="(msg: string, err?: boolean) => emit('notify', msg, err)"
      />
      <input ref="coverFileInput" type="file" accept="image/*" hidden @change="onCoverPick" />

      <div class="field">
        <label>正文（可直接拖入或粘贴图片）</label>
        <div v-if="contentRisk" class="risk-banner">{{ contentRisk }}</div>
        <div class="editor-shell">
          <EditorToolbar
            :mode="mode"
            :editor="editor"
            :uploading="uploading"
            :show-border-menu="showBorderMenu"
            :show-block-drawer="showBlockDrawer"
            @switch-mode="onSwitchMode"
            @snippet="insertSnippet"
            @insert-block="insertBlock"
            @insert-image="imageFileInput?.click()"
            @open-picker="openPicker"
            @set-link="setLink"
            @toggle-borders="showBorderMenu = !showBorderMenu"
            @toggle-blocks="showBlockDrawer = !showBlockDrawer"
          />
          <input ref="imageFileInput" type="file" accept="image/*" hidden @change="onImagePick" />

          <div v-show="mode === 'wysiwyg'" class="wysiwyg-area">
            <div class="editor-float">
              <EditorBorderMenu
                v-if="showBorderMenu && editor?.isActive('table')"
                :borders="currentBorders()"
                @preset="applyBordersPreset"
                @toggle="toggleBorder"
                @close="showBorderMenu = false"
              />
              <EditorBlockDrawer
                v-if="showBlockDrawer"
                @insert="insertBlk"
                @close="showBlockDrawer = false"
              />
            </div>
            <div class="wysiwyg-body">
              <div v-if="activeBlk" class="blk-bar">
                <span class="blk-bar-label">{{ findBlock(activeBlk.block)?.label ?? activeBlk.block }}</span>
                <template v-if="activeBlkVariantOptions.length > 0">
                  <button
                    v-for="v in activeBlkVariantOptions"
                    :key="v.value"
                    type="button"
                    class="blk-chip"
                    :class="{ 'is-active': activeBlk.variant === v.value }"
                    @click="editor?.chain().focus().setPrBlockVariant(v.value).run()"
                  >
                    {{ v.label }}
                  </button>
                </template>
                <span class="sep"></span>
                <button type="button" class="blk-chip" title="拆掉外壳，保留文字" @click="editor?.chain().focus().unwrapPrBlock().run()">拆壳</button>
              </div>
              <EditorContent :editor="editor" />
            </div>
          </div>
          <EditorSourcePane
            v-if="mode === 'source'"
            ref="sourcePane"
            v-model="sourceMarkdown"
          />
        </div>
      </div>

      <div class="footer-actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '落印中…' : isEdit ? '存 篇' : '成 篇' }}
        </button>
        <input
          v-model="form.version_message"
          class="input input-version"
          placeholder="本次修改说明（可选，写入版本记录）"
        />
        <a
          v-if="loadedId !== null"
          class="btn btn-ghost"
          :href="`/preview/${loadedId}`"
          target="_blank"
          rel="noopener"
        >
          预览
        </a>
        <button v-if="loadedId !== null" class="btn btn-ghost" type="button" @click="openVersions">版本</button>
        <button v-if="loadedId !== null" class="btn btn-ghost" type="button" :disabled="exporting" @click="exportMarkdown">
          {{ exporting ? '导出中…' : '导出 Markdown' }}
        </button>
        <router-link class="btn btn-ghost" to="/posts">回篇目</router-link>
      </div>
    </form>
  </div>

  <MediaPickerModal
    v-if="showPicker"
    @close="showPicker = false"
    @notify="emit('notify', $event)"
    @pick="insertMedia"
  />

  <VersionPanel
    v-if="showVersions && loadedId !== null"
    :post-id="loadedId"
    :current-markdown="currentMarkdown"
    @close="showVersions = false"
    @notify="emit('notify', $event)"
    @restored="afterVersionRestore"
  />
</template>

<style scoped>
.risk-banner {
  margin: 0 0 10px;
  padding: 10px 14px;
  font-size: 0.85rem;
  line-height: 1.6;
  color: #8a5a12;
  background: #fdf3d8;
  border: 1px solid #e8d3a0;
  border-radius: 6px;
}

/* 源码模式与工具条的样式随各自组件移出（EditorSourcePane.vue / EditorToolbar.vue） */
</style>