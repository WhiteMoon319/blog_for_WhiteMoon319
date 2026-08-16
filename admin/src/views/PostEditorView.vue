<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { diffLines, diffWords } from 'diff';
import { api } from '../api';
import type { Collection, MediaFile, PostVersion } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();
const route = useRoute();
const router = useRouter();

const collections = ref<Collection[]>([]);
const loading = ref(true);
const saving = ref(false);
const uploading = ref(false);
const loadedId = ref<number | null>(null);

const isEdit = computed(() => loadedId.value !== null);

const form = reactive({
  title: '',
  slug: '',
  collection_id: null as number | null,
  summary: '',
  cover_url: '',
  status: 'draft' as 'draft' | 'published',
  version_message: '',
});
const coverFileInput = ref<HTMLInputElement | null>(null);
const imageFileInput = ref<HTMLInputElement | null>(null);

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });

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
    StarterKit,
    Link.configure({ openOnClick: false, autolink: true }),
    Image,
    Placeholder.configure({ placeholder: '落笔于此，墨韵自生……' }),
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

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function load() {
  if (collections.value.length === 0) {
    const cols = await api.collections();
    collections.value = cols.collections;
  }

  const id = parseId(route.query.id);
  loadedId.value = id;
  form.version_message = '';
  if (id) {
    const { post } = await api.post(id);
    form.title = post.title;
    form.slug = post.slug;
    form.collection_id = post.collection_id;
    form.summary = post.summary;
    form.cover_url = post.cover_url;
    form.status = post.status;
    if (editor.value) editor.value.commands.setContent(marked.parse(post.content_md) as string);
  } else {
    form.title = '';
    form.slug = '';
    form.collection_id = null;
    form.summary = '';
    form.cover_url = '';
    form.status = 'draft';
    form.version_message = '';
    const cid = parseId(route.query.collection);
    form.collection_id = collections.value.some((c) => c.id === cid) ? cid : null;
    if (editor.value) editor.value.commands.setContent('');
  }
  loading.value = false;
}

onMounted(() => {
  load().catch((e) => emit('notify', (e as Error).message, true));
});

watch(
  () => [route.query.id, route.query.collection] as const,
  async ([id, collection]) => {
    if (loading.value) return;
    const next = parseId(id);
    if (next !== null && next === loadedId.value) return;
    loading.value = true;
    try {
      await load();
    } catch (e) {
      emit('notify', (e as Error).message, true);
      loading.value = false;
    }
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});

async function save() {
  if (!form.title.trim()) return emit('notify', '篇名不可为空', true);
  if (!editor.value) return;
  saving.value = true;
  try {
    const content_md = turndown.turndown(editor.value.getHTML());
    const payload = {
      title: form.title.trim(),
      slug: form.slug,
      collection_id: form.collection_id,
      summary: form.summary,
      cover_url: form.cover_url,
      content_md,
      status: form.status,
      version_message: form.version_message.trim(),
    };
    if (loadedId.value !== null) {
      await api.updatePost(loadedId.value, payload);
      emit('notify', '篇章已存');
      form.version_message = '';
    } else {
      const { post } = await api.createPost(payload);
      emit('notify', '新篇已成');
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
const pickerFiles = ref<MediaFile[]>([]);
const pickerCursor = ref<string | undefined>(undefined);
const pickerBusy = ref(false);

async function pickerLoad() {
  if (pickerBusy.value) return;
  pickerBusy.value = true;
  try {
    const res = await api.media(pickerCursor.value);
    pickerFiles.value.push(...res.files);
    pickerCursor.value = res.cursor;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    pickerBusy.value = false;
  }
}

function openPicker() {
  if (pickerFiles.value.length === 0) void pickerLoad();
  showPicker.value = true;
}

function insertMedia(url: string) {
  editor.value?.chain().focus().setImage({ src: url }).run();
  showPicker.value = false;
}

interface DiffSeg {
  kind: 'add' | 'del' | 'ctx';
  paired: boolean;
  line: string;
  words: Array<{ kind: 'add' | 'del' | 'keep'; text: string }>;
}

const showVersions = ref(false);
const versions = ref<PostVersion[]>([]);
const versionsBusy = ref(false);
const selVersion = ref<number | null>(null);
const cmpTarget = ref<number | 'current'>('current');
const diffSegs = ref<DiffSeg[] | null>(null);
const diffMeta = ref('');

function currentMarkdown(): string {
  if (!editor.value) return '';
  return turndown.turndown(editor.value.getHTML());
}

function computeDiff(a: string, b: string): DiffSeg[] {
  const parts = diffLines(a, b);
  const segs: DiffSeg[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const splitLines = (v: string) => {
    const lines = v.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const flushPair = () => {
    while (dels.length > 0 && adds.length > 0) {
      const d = dels.shift()!;
      const ad = adds.shift()!;
      const words = diffWords(d, ad).map((w) => ({
        kind: w.removed ? ('del' as const) : w.added ? ('add' as const) : ('keep' as const),
        text: w.value,
      }));
      segs.push({ kind: 'del', line: d, words, paired: true });
      segs.push({ kind: 'add', line: ad, words, paired: true });
    }
    for (const d of dels) segs.push({ kind: 'del', line: d, words: [], paired: false });
    for (const ad of adds) segs.push({ kind: 'add', line: ad, words: [], paired: false });
    dels = [];
    adds = [];
  };
  for (const p of parts) {
    if (p.removed) dels.push(...splitLines(p.value));
    else if (p.added) adds.push(...splitLines(p.value));
    else {
      flushPair();
      for (const l of splitLines(p.value)) segs.push({ kind: 'ctx', line: l, words: [], paired: false });
    }
  }
  flushPair();
  return segs;
}

function metaOf(v: PostVersion, label: string): string {
  const bits = [`v${v.version} · ${label}`, v.status === 'published' ? '已刊' : '草稿'];
  if (v.collection_id !== null) bits.push(`文集#${v.collection_id}`);
  if (v.slug) bits.push(v.slug);
  if (v.summary) bits.push('有摘要');
  if (v.cover_url) bits.push('有封面');
  return bits.join('　');
}

async function refreshDiff() {
  if (selVersion.value === null) {
    diffSegs.value = null;
    diffMeta.value = '';
    return;
  }
  const base = versions.value.find((v) => v.version === selVersion.value);
  if (!base) return;
  if (cmpTarget.value === 'current') {
    diffSegs.value = computeDiff(base.content_md, currentMarkdown());
    diffMeta.value = metaOf(base, '基线') + '\n→ 当前工作区（未保存）';
  } else {
    const other = versions.value.find((v) => v.version === cmpTarget.value);
    if (!other) return;
    diffSegs.value = computeDiff(base.content_md, other.content_md);
    diffMeta.value = metaOf(base, '基线') + '\n→ ' + metaOf(other, '对比');
  }
}

async function openVersions() {
  if (loadedId.value === null) return;
  showVersions.value = true;
  versionsBusy.value = true;
  try {
    const res = await api.postVersions(loadedId.value);
    versions.value = res.versions;
    const first = res.versions[0];
    selVersion.value = first ? first.version : null;
    cmpTarget.value = 'current';
    await refreshDiff();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    versionsBusy.value = false;
  }
}

async function restoreVersion(v: PostVersion) {
  if (loadedId.value === null) return;
  if (!confirm(`确认回滚到 v${v.version}（${v.created_at.slice(0, 10)}）？当前内容将被覆盖，并生成一条新版本记录。`)) return;
  versionsBusy.value = true;
  try {
    await api.restorePostVersion(loadedId.value, v.version);
    emit('notify', `已回滚至 v${v.version}`);
    await load();
    const res = await api.postVersions(loadedId.value);
    versions.value = res.versions;
    selVersion.value = res.versions[0]?.version ?? null;
    await refreshDiff();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    versionsBusy.value = false;
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
        <label>摘要</label>
        <textarea v-model="form.summary" class="textarea" placeholder="列表卡上的一行小字"></textarea>
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
        <div class="editor-shell">
          <div class="editor-toolbar">
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
            <button type="button" :class="{ 'is-active': editor?.isActive('link') }" @click="setLink">链</button>
            <button type="button" @click="imageFileInput?.click()" :disabled="uploading">{{ uploading ? '…' : '图' }}</button>
            <input ref="imageFileInput" type="file" accept="image/*" hidden @change="onImagePick" />
            <button type="button" @click="openPicker" title="从媒体库选择">库</button>
            <button type="button" @click="editor?.chain().focus().setHorizontalRule().run()">—</button>
            <span class="sep"></span>
            <button type="button" @click="editor?.chain().focus().undo().run()">↩</button>
            <button type="button" @click="editor?.chain().focus().redo().run()">↪</button>
          </div>
          <EditorContent :editor="editor" />
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
        <router-link class="btn btn-ghost" to="/posts">回篇目</router-link>
      </div>
    </form>
  </div>

  <div v-if="showPicker" class="media-mask" @click.self="showPicker = false">
    <div class="media-modal">
      <div class="media-modal-head">
        <span>从相册取图</span>
        <button class="btn btn-ghost mini" @click="showPicker = false">关</button>
      </div>
      <div class="media-modal-body">
        <div v-if="pickerFiles.length" class="media-modal-grid">
          <button
            v-for="f in pickerFiles"
            :key="f.key"
            class="media-thumb"
            :title="f.key"
            @click="insertMedia(f.url)"
          >
            <img :src="f.url" :alt="f.key" loading="lazy" />
          </button>
        </div>
        <div v-else class="empty">相册空空…</div>
        <div v-if="pickerCursor" style="text-align:center;padding-top:12px;">
          <button class="btn btn-ghost mini" :disabled="pickerBusy" @click="pickerLoad">
            {{ pickerBusy ? '载入中…' : '加载更多' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showVersions" class="media-mask" @click.self="showVersions = false">
    <div class="media-modal" style="width:min(1080px, 96vw);">
      <div class="media-modal-head">
        <span>版本史（每次保存自动留档，可对比与回滚）</span>
        <button class="btn btn-ghost mini" @click="showVersions = false">关</button>
      </div>
      <div class="versions-body">
        <aside class="versions-list">
          <div v-if="versionsBusy" class="empty">载入中…</div>
          <template v-else>
            <div
              v-for="v in versions"
              :key="v.version"
              class="ver-item"
              :class="{ on: selVersion === v.version }"
              @click="selVersion = v.version; refreshDiff()"
            >
              <div class="ver-head">
                <span class="ver-no">v{{ v.version }}</span>
                <span class="ver-date">{{ v.created_at.slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <div class="ver-msg">{{ v.message || '自动保存' }}</div>
              <div class="ver-title">{{ v.title }}</div>
              <div class="ver-foot">
                <span class="tag" :class="v.status === 'published' ? 'tag-published' : 'tag-draft'">
                  {{ v.status === 'published' ? '已刊' : '草稿' }}
                </span>
                <button class="btn btn-danger mini" :disabled="versionsBusy" @click.stop="restoreVersion(v)">
                  回滚到此
                </button>
              </div>
            </div>
            <div v-if="versions.length === 0" class="empty">尚无版本。</div>
          </template>
        </aside>
        <section class="versions-diff">
          <div class="diff-toolbar">
            <select v-model="selVersion" class="select" @change="refreshDiff" style="width:auto;">
              <option v-for="v in versions" :key="v.version" :value="v.version">基线 v{{ v.version }}（{{ v.created_at.slice(0, 10) }}）</option>
            </select>
            <span class="diff-arrow">→</span>
            <select v-model="cmpTarget" class="select" @change="refreshDiff" style="width:auto;">
              <option value="current">当前工作区（未保存）</option>
              <option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }}（{{ v.created_at.slice(0, 10) }}）</option>
            </select>
            <span class="diff-legend">
              <span class="lg lg-add">＋新增</span>
              <span class="lg lg-del">－删除</span>
            </span>
          </div>
          <pre class="diff-view" v-if="diffSegs">
<template v-for="(seg, i) in diffSegs" :key="i"><span class="diff-line" :class="[seg.kind, seg.paired ? 'pair' : 'full']"><span class="diff-mark">{{ seg.kind === 'add' ? '+' : seg.kind === 'del' ? '-' : ' ' }}</span><span v-if="seg.words.length" class="diff-words"><template v-for="(w, j) in seg.words" :key="j"><span :class="'dw ' + w.kind">{{ w.text }}</span></template></span><template v-else>{{ seg.line }}</template></span>
</template>
</pre>
          <div v-else class="empty">选择基线后显示差异。</div>
          <div class="diff-meta" v-if="diffMeta">{{ diffMeta }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 16, 0.5);
  display: grid;
  place-items: center;
  z-index: 60;
}
.media-modal {
  width: min(760px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--paper-card);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  overflow: hidden;
}
.media-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
  font-family: var(--font-serif);
  color: var(--ink-deep);
}
.media-modal-body {
  padding: 16px;
  overflow-y: auto;
}
.media-modal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}
.media-thumb {
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: none;
}
.media-thumb img {
  width: 100%;
  height: 100px;
  object-fit: cover;
  display: block;
}
.media-thumb:hover {
  border-color: var(--cinnabar);
}

.versions-body {
  display: flex;
  min-height: 380px;
  max-height: 70vh;
}
.versions-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ver-item {
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--paper-card);
}
.ver-item.on {
  border-color: var(--cinnabar);
  background: color-mix(in srgb, var(--cinnabar) 6%, var(--paper-card));
}
.ver-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.ver-no {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--cinnabar);
}
.ver-date {
  font-size: 0.72rem;
  color: var(--ink-light);
}
.ver-msg {
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-title {
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--ink-deep);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-foot {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.versions-diff {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
}
.diff-arrow {
  color: var(--ink-light);
}
.diff-legend {
  margin-left: auto;
  display: flex;
  gap: 10px;
  font-size: 0.75rem;
}
.lg {
  padding: 2px 8px;
  border-radius: 4px;
}
.lg-add {
  background: rgba(45, 106, 79, 0.14);
  color: #2d6a4f;
}
.lg-del {
  background: rgba(194, 58, 48, 0.14);
  color: #c23a30;
}
.diff-view {
  flex: 1;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
.diff-line {
  display: block;
}
.diff-line.del.full {
  background: rgba(194, 58, 48, 0.12);
  color: #9c2f26;
}
.diff-line.add.full {
  background: rgba(45, 106, 79, 0.12);
  color: #1f5c40;
}
.diff-line.pair {
  background: transparent;
}
.diff-line.ctx {
  color: var(--ink-soft);
}
.diff-mark {
  display: inline-block;
  width: 1.2em;
  user-select: none;
}
.dw.add {
  background: rgba(45, 106, 79, 0.3);
}
.dw.del {
  background: rgba(194, 58, 48, 0.3);
}
.diff-meta {
  padding: 10px 16px;
  border-top: 1px solid var(--hairline);
  font-size: 0.75rem;
  color: var(--ink-light);
  white-space: pre-wrap;
}
</style>