<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
const lowlight = createLowlight(common);
import { marked } from 'marked';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown as markdownLang, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { api, download } from '../api';
import type { Collection } from '../types';
import TagChips from '../components/TagChips.vue';
import VersionPanel from '../components/VersionPanel.vue';
import MediaPickerModal from '../components/MediaPickerModal.vue';
import { createTurndown, checkContentRisk } from '../lib/editor';
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
});
const coverFileInput = ref<HTMLInputElement | null>(null);
const imageFileInput = ref<HTMLInputElement | null>(null);

// 编辑器不支持的结构提示：加载/保存时检测 markdown 表格与块级 HTML，避免往返后静默丢失
const contentRisk = ref('');

const turndown = createTurndown();

const uploadingKeys = new Set<string>();

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
    Table.configure({ resizable: true, HTMLAttributes: { class: 'tip-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight }),
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
});

// ---- 源码模式：CodeMirror 编辑 + 实时预览（debounced 调 /api/render，与公开站点同链路） ----
const mode = ref<'wysiwyg' | 'source'>('wysiwyg');
const sourceMarkdown = ref('');
const previewHtml = ref('');
const previewing = ref(false);
const cmHost = ref<HTMLDivElement | null>(null);
let cmView: EditorView | null = null;
let cmLang = new Compartment();

function buildCmState(md: string): EditorState {
  return EditorState.create({
    doc: md,
    extensions: [
      cmLang.of([markdownLang({ base: markdownLanguage })]),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          sourceMarkdown.value = update.state.doc.toString();
          schedulePreview();
        }
      }),
    ],
  });
}

function mountSourceEditor() {
  if (!cmHost.value) return;
  cmView = new EditorView({ state: buildCmState(sourceMarkdown.value), parent: cmHost.value });
  cmView.focus();
}

let previewTimer: number | null = null;
let previewSeq = 0;
async function schedulePreview() {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void runPreview(), 400);
}

async function runPreview() {
  const md = sourceMarkdown.value;
  previewing.value = true;
  try {
    const { html } = await api.render(md);
    if (md === sourceMarkdown.value) previewHtml.value = html; // 丢弃过期响应
  } catch {
    // 预览失败保留上一次成功结果
  } finally {
    previewing.value = false;
  }
}

function switchToSource() {
  if (mode.value === 'source') return;
  sourceMarkdown.value = currentMarkdown();
  mode.value = 'source';
  requestAnimationFrame(() => {
    if (!cmView) mountSourceEditor();
    void runPreview();
  });
}

function switchToWysiwyg() {
  if (mode.value === 'wysiwyg') return;
  if (editor.value) editor.value.commands.setContent(marked.parse(sourceMarkdown.value) as string);
  contentRisk.value = checkContentRisk(sourceMarkdown.value);
  mode.value = 'wysiwyg';
}

function insertSnippet(before: string, after = '', placeholder = ''): void {
  const view = cmView;
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const insert = `${before}${placeholder}${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length, head: from + before.length + placeholder.length },
  });
  view.focus();
}

function insertBlock(block: string) {
  const view = cmView;
  if (!view) return;
  const text = view.state.doc.toString();
  const insert = `\n\n${block}\n\n`;
  view.dispatch({ changes: { from: 0, to: text.length, insert: text.trim() ? text.replace(/\n+$/, '') + insert : insert } });
  view.focus();
}

function currentMarkdown(): string {
  if (mode.value === 'source') return sourceMarkdown.value;
  return turndown.turndown(editor.value?.getHTML() ?? '');
}

async function load() {
  if (collections.value.length === 0) {
    const cols = await api.collections();
    collections.value = cols.collections;
  }

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
    contentRisk.value = checkContentRisk(post.content_md);
    if (editor.value) editor.value.commands.setContent(marked.parse(post.content_md) as string);
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
    const cid = parseId(route.query.collection);
    if (cid && collections.value.some((c) => c.id === cid)) form.collection_id = cid;
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
  contentRisk.value = checkContentRisk(s.content_md);
  if (editor.value) editor.value.commands.setContent(marked.parse(s.content_md) as string);
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
  cmView?.destroy();
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
</script>

<template>
  <div class="page-head">
    <span class="kicker">{{ isEdit ? '改 篇' : '新 篇' }}</span>
    <h1>{{ isEdit ? '修改篇章' : '写下新篇' }}</h1>
  </div>

  <div v-if="!loading" class="card pad">
    <form @submit.prevent="save">
      <div class="form-row">
        <div class="field">
          <label>篇名 *</label>
          <input v-model="form.title" class="input" placeholder="如：把 Astro 架到 Cloudflare 上" />
        </div>
        <div class="field">
          <label>URL 标识（可留空自动生成）</label>
          <input v-model="form.slug" class="input" placeholder="astro-on-cloudflare" />
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label>所属文集</label>
          <select v-model="form.collection_id" class="select">
            <option :value="null">未分类</option>
            <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
          </select>
        </div>
        <div class="field">
          <label>状态</label>
          <select v-model="form.status" class="select">
            <option value="draft">草稿（暂不示人）</option>
            <option value="published">刊发（立即示人）</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>标签（自有，叠加在文集标签之上）</label>
        <TagChips v-model="form.tags" :suggestions="suggestions" placeholder="回车添加标签" />
        <div v-if="form.inherited_tags.length" class="hint" style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          继承自文集：
          <span v-for="t in form.inherited_tags" :key="t" class="tag-chip-item is-readonly">{{ t }}</span>
        </div>
      </div>

      <div class="field">
        <label>摘要</label>
        <textarea v-model="form.summary" class="textarea" placeholder="列表卡上的一行小字"></textarea>
      </div>

      <div class="field">
        <label>SEO 关键词（meta keywords，逗号分隔，最多 200 字）</label>
        <input v-model="form.meta_keywords" class="input" maxlength="200" placeholder="文章、随笔、书房" />
      </div>

      <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">
        <input
          type="checkbox"
          :checked="form.is_pinned === 1"
          @change="form.is_pinned = ($event.target as HTMLInputElement).checked ? 1 : 0"
        />
        置顶（首页「置于案头」区展示，列表内仍照常可见）
      </label>

      <div class="field">
        <label>定时发布（到点自动刊发；仅草稿可设）</label>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">
            <input
              type="checkbox"
              v-model="form.scheduled_enabled"
              :disabled="form.status === 'published'"
            />
            启用
          </label>
          <input
            v-if="form.scheduled_enabled"
            v-model="form.scheduled_local"
            type="datetime-local"
            step="60"
            class="input"
            style="width:auto;"
          />
        </div>
        <div class="hint" style="margin-top:8px;">
          按本机时区展示，提交后转为 UTC 存储；cron 每 5 分钟轮询，到点可能略有延迟，不承诺秒级准点。
          手动刊发会清空定时。
        </div>
      </div>

      <div class="field">
        <label>封面</label>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-ghost" type="button" @click="coverFileInput?.click()" :disabled="uploading">上传封面</button>
          <input ref="coverFileInput" type="file" accept="image/*" hidden @change="onCoverPick" />
          <img
            v-if="form.cover_url"
            :src="form.cover_url"
            alt="封面"
            style="max-height:80px;border-radius:6px;border:1px solid var(--hairline);"
          />
          <button v-if="form.cover_url" class="btn btn-danger mini" type="button" @click="form.cover_url = ''">
            去封面
          </button>
        </div>
      </div>

      <div class="field">
        <label>正文（可直接拖入或粘贴图片）</label>
        <div v-if="contentRisk" class="risk-banner">{{ contentRisk }}</div>
        <div class="editor-shell">
          <div class="editor-toolbar">
            <button type="button" class="mode-toggle" :class="{ active: mode === 'wysiwyg' }" @click="switchToWysiwyg">可视化</button>
            <button type="button" class="mode-toggle" :class="{ active: mode === 'source' }" @click="switchToSource">源码</button>
            <span class="sep"></span>

            <template v-if="mode === 'wysiwyg'">
              <button type="button" :class="{ 'is-active': editor?.isActive('bold') }" @click="editor?.chain().focus().toggleBold().run()"><b>B</b></button>
              <button type="button" :class="{ 'is-active': editor?.isActive('italic') }" @click="editor?.chain().focus().toggleItalic().run()"><i>I</i></button>
              <button type="button" :class="{ 'is-active': editor?.isActive('strike') }" @click="editor?.chain().focus().toggleStrike().run()"><s>S</s></button>
              <span class="sep"></span>
              <button type="button" :class="{ 'is-active': editor?.isActive('heading', { level: 2 }) }" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
              <button type="button" :class="{ 'is-active': editor?.isActive('heading', { level: 3 }) }" @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
              <span class="sep"></span>
              <button type="button" :class="{ 'is-active': editor?.isActive('bulletList') }" @click="editor?.chain().focus().toggleBulletList().run()">• 列表</button>
              <button type="button" :class="{ 'is-active': editor?.isActive('orderedList') }" @click="editor?.chain().focus().toggleOrderedList().run()">1. 列表</button>
              <button type="button" :class="{ 'is-active': editor?.isActive('blockquote') }" @click="editor?.chain().focus().toggleBlockquote().run()">引文</button>
              <button type="button" :class="{ 'is-active': editor?.isActive('codeBlock') }" @click="editor?.chain().focus().toggleCodeBlock().run()">代码</button>
              <span class="sep"></span>
              <button type="button" :class="{ 'is-active': editor?.isActive('table') }" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()">表</button>
              <button type="button" :class="{ 'is-active': editor?.isActive('link') }" @click="setLink">链</button>
              <button type="button" @click="imageFileInput?.click()" :disabled="uploading">{{ uploading ? '…' : '图' }}</button>
              <input ref="imageFileInput" type="file" accept="image/*" hidden @change="onImagePick" />
              <button type="button" @click="openPicker" title="从媒体库选择">库</button>
              <button type="button" @click="editor?.chain().focus().setHorizontalRule().run()">—</button>
              <span class="sep"></span>
              <button type="button" @click="editor?.chain().focus().undo().run()">↩</button>
              <button type="button" @click="editor?.chain().focus().redo().run()">↪</button>
            </template>

            <template v-else>
              <button type="button" title="粗体" @click="insertSnippet('**', '**', '文本')"><b>B</b></button>
              <button type="button" title="斜体" @click="insertSnippet('*', '*', '文本')"><i>I</i></button>
              <button type="button" title="删除线" @click="insertSnippet('~~', '~~', '文本')"><s>S</s></button>
              <span class="sep"></span>
              <button type="button" title="标题" @click="insertSnippet('## ', '', '小标题')">H2</button>
              <button type="button" title="链接" @click="insertSnippet('[', '](https://)', '链接文字')">链</button>
              <button type="button" title="图片" @click="insertSnippet('![', '](https://)', '描述')">图</button>
              <span class="sep"></span>
              <button type="button" title="引文" @click="insertBlock('> 引用文字')">引文</button>
              <button type="button" title="无序列表" @click="insertSnippet('- 条目')">• 列表</button>
              <button type="button" title="有序列表" @click="insertSnippet('1. 条目')">1. 列表</button>
              <span class="sep"></span>
              <button type="button" title="代码块" @click="insertBlock('```\n代码…\n```')">代码</button>
              <button type="button" title="表格" @click="insertBlock('| 列一 | 列二 |\n| --- | --- |\n| 单元格 | 单元格 |')">表</button>
              <span class="sep"></span>
              <button type="button" title="行内公式" @click="insertSnippet('$', '$', 'E = mc^2')">∑ 行内</button>
              <button type="button" title="块级公式" @click="insertBlock('$$\nE = mc^2\n$$')">∑ 公式</button>
              <span class="sep"></span>
              <button type="button" title="Mermaid 图表" @click="insertBlock('```mermaid\ngraph TD\n  A[起点] --> B{判断}\n  B -->|是| C[结果]\n  B -->|否| D[另一路径]\n```')">Mermaid</button>
              <button type="button" title="Markmap 脑图" @click="insertBlock('```markmap\n# 脑图标题\n## 分支一\n### 子分支\n## 分支二\n```')">Markmap</button>
            </template>
          </div>

          <div v-show="mode === 'wysiwyg'" class="wysiwyg-area">
            <EditorContent :editor="editor" />
          </div>
          <div v-show="mode === 'source'" class="source-area">
            <div ref="cmHost" class="cm-host" />
            <div class="source-preview" :class="{ refreshing: previewing }">
              <p v-if="previewing" class="preview-hint">渲染中…</p>
              <div v-html="previewHtml" />
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '落印中…' : isEdit ? '存 篇' : '成 篇' }}
        </button>
        <input
          v-model="form.version_message"
          class="input"
          style="width:230px;padding:8px 12px;"
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

.source-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 420px;
}

.cm-host {
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: #fbfaf8;
  font-size: 0.9rem;
  line-height: 1.7;
}

.cm-host .cm-editor {
  min-height: 420px;
  outline: none;
}

.source-preview {
  overflow: auto;
  padding: 16px 20px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--paper-card);
}

.source-preview h1,
.source-preview h2,
.source-preview h3 {
  line-height: 1.4;
}

.source-preview pre {
  overflow-x: auto;
  padding: 14px 16px;
  border-radius: 6px;
  background: var(--ink-black);
  color: #e8e4dc;
}

.source-preview code {
  font-family: Consolas, 'SF Mono', Menlo, monospace;
  font-size: 0.85rem;
}

.source-preview table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.source-preview th,
.source-preview td {
  padding: 0.4em 0.8em;
  border: 1px solid var(--hairline);
}

.preview-hint {
  color: var(--ink-light);
  font-size: 0.8rem;
}

.source-preview.refreshing {
  opacity: 0.6;
  transition: opacity 0.15s ease;
}

.mode-toggle {
  padding: 4px 12px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-light);
  cursor: pointer;
  font: inherit;
}

.mode-toggle.active {
  background: var(--cinnabar);
  color: #fff;
  border-color: var(--cinnabar);
}

@media (max-width: 900px) {
  .source-area {
    grid-template-columns: 1fr;
  }
}
</style>