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
import { api } from '../api';
import type { Collection } from '../types';

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
    };
    if (loadedId.value !== null) {
      await api.updatePost(loadedId.value, payload);
      emit('notify', '篇章已存');
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
            <button type="button" @click="editor?.chain().focus().setHorizontalRule().run()">—</button>
            <span class="sep"></span>
            <button type="button" @click="editor?.chain().focus().undo().run()">↩</button>
            <button type="button" @click="editor?.chain().focus().redo().run()">↪</button>
          </div>
          <EditorContent :editor="editor" />
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '落印中…' : isEdit ? '存 篇' : '成 篇' }}
        </button>
        <router-link class="btn btn-ghost" to="/posts">回篇目</router-link>
      </div>
    </form>
  </div>
</template>