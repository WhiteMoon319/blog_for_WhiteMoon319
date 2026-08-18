<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { marked } from 'marked';
import { api } from '../api';
import type { Collection, MediaFile } from '../types';
import TagChips from '../components/TagChips.vue';
import VersionPanel from '../components/VersionPanel.vue';
import MediaPickerModal from '../components/MediaPickerModal.vue';
import { createTurndown, checkContentRisk } from '../lib/editor';

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

function currentMarkdown(): string {
  if (!editor.value) return '';
  return turndown.turndown(editor.value.getHTML());
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
    form.status = post.status;
    form.tags = tags.map((t) => t.name);
    contentRisk.value = checkContentRisk(post.content_md);
    if (editor.value) editor.value.commands.setContent(marked.parse(post.content_md) as string);
  } else {
    form.title = '';
    form.slug = '';
    form.collection_id = null;
    form.summary = '';
    form.cover_url = '';
    form.status = 'draft';
    form.version_message = '';
    form.tags = [];
    form.inherited_tags = [];
    const cid = parseId(route.query.collection);
    if (cid && collections.value.some((c) => c.id === cid)) form.collection_id = cid;
    contentRisk.value = '';
    if (editor.value) editor.value.commands.setContent('');
  }
}

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

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

watch(() => [route.query.id, route.query.collection] as const, async ([id, collection]) => {
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
});

onMounted(() => {
  void load().catch((e) => emit('notify', (e as Error).message, true)).finally(() => (loading.value = false));
  api.tags().then((r) => (suggestions.value = r.tags.map((t) => t.name))).catch(() => {});
});

onBeforeUnmount(() => {
  editor.value?.destroy();
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
      content_md,
      status: form.status,
      version_message: form.version_message.trim(),
      tags: form.tags,
      base_version: baseVersion.value,
    };
    if (loadedId.value !== null) {
      const { version } = await api.updatePost(loadedId.value, payload);
      baseVersion.value = version;
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
const pickerRef = ref<InstanceType<typeof MediaPickerModal> | null>(null);

function openPicker() {
  showPicker.value = true;
  void pickerRef.value?.load();
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

  <MediaPickerModal
    v-if="showPicker"
    ref="pickerRef"
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
    @restored="load"
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
</style>