<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import PageHead from '../components/PageHead.vue';
import {
  buildImportPayloads,
  slugify,
  stem,
  titleFromMarkdown,
  summaryFromMarkdown,
  looksLikeMarkdown,
  plainToParagraphs,
  firstHeadingFromHtml,
  EXT_MIME,
} from '../lib/import';
import { createTurndown } from '../lib/editor';
import type { Collection } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface ImportItem {
  file: string;
  title: string;
  slug: string;
  summary: string;
  contentMd: string;
  state: 'ready' | 'done' | 'failed';
  error: string;
}

const collections = ref<Collection[]>([]);
const items = ref<ImportItem[]>([]);
const importing = ref(false);
const collectionId = ref<number | null>(null);
const status = ref<'draft' | 'published'>('draft');
const slugMode = ref<'auto' | 'manual'>('auto');
const fileInput = ref<HTMLInputElement | null>(null);

const turndown = createTurndown();

const importedIds = ref<number[]>([]);
const generatingAi = ref(false);
const aiResults = ref<Record<number, string>>({});

// 从 localStorage 恢复上次导入的 ID
const IMPORTED_IDS_KEY = 'imported_post_ids';
onMounted(async () => {
  try {
    const c = await api.collections();
    collections.value = c.collections;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
  try {
    const saved = localStorage.getItem(IMPORTED_IDS_KEY);
    if (saved) importedIds.value = JSON.parse(saved);
  } catch {}
});

const ALLOWED_EXT = ['md', 'markdown', 'txt', 'docx'];

// 文件来源无关：选择框与拖入都走这里
async function addFiles(files: File[]) {
  if (files.length === 0) return;
  for (const file of files) {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      emit('notify', `跳过不支持的格式：${file.name}`, true);
      continue;
    }
    try {
      items.value.push(await parseOne(file, ext));
    } catch (err) {
      emit('notify', `解析失败：${file.name} — ${(err as Error).message}`, true);
    }
  }
  emit('notify', `已就绪 ${items.value.length} 篇`);
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  await addFiles(files);
}

// 拖入文件：用进入计数抵消子元素反复触发的 dragenter/dragleave，避免高亮闪烁
const dragActive = ref(false);
let dragDepth = 0;
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}
function onDragEnter(e: DragEvent) {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  dragActive.value = true;
}
function onDragOver(e: DragEvent) {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}
function onDragLeave(e: DragEvent) {
  if (!dragHasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragActive.value = false;
}
async function onDrop(e: DragEvent) {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dragActive.value = false;
  await addFiles(Array.from(e.dataTransfer?.files ?? []));
}
function pickFiles() {
  fileInput.value?.click();
}

async function parseOne(file: File, ext: string): Promise<ImportItem> {
  const name = stem(file.name);
  if (ext === 'md' || ext === 'markdown') {
    const text = await file.text();
    const title = titleFromMarkdown(text, name);
    return {
      file: file.name,
      title,
      slug: slugify(title),
      summary: summaryFromMarkdown(text),
      contentMd: text,
      state: 'ready',
      error: '',
    };
  }
  if (ext === 'txt') {
    const text = await file.text();
    if (looksLikeMarkdown(text)) {
      const title = titleFromMarkdown(text, name);
      return {
        file: file.name,
        title,
        slug: slugify(title),
        summary: summaryFromMarkdown(text),
        contentMd: text,
        state: 'ready',
        error: '',
      };
    }
    const first =
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? name;
    return {
      file: file.name,
      title: first.length > 40 ? name : first,
      slug: slugify(first.length > 40 ? name : first),
      summary: summaryFromMarkdown(plainToParagraphs(text)),
      contentMd: plainToParagraphs(text),
      state: 'ready',
      error: '',
    };
  }
  // docx（mammoth 体积大，选中文件时才按需加载）
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const html = (
    await mammoth.convertToHtml({
      arrayBuffer,
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const ext = EXT_MIME[image.contentType] ?? '';
          if (!ext) return null;
          const buf = await image.readAsArrayBuffer();
          const f = new File([buf], `docx-image-${Date.now()}.${ext}`, { type: image.contentType });
          const { url } = await api.upload(f);
          return { src: url };
        } catch {
          return null;
        }
      }),
    })
  ).value;
  const title = firstHeadingFromHtml(html) ?? name;
  return {
    file: file.name,
    title,
    slug: slugify(title),
    summary: summaryFromMarkdown(turndown.turndown(html)),
    contentMd: turndown.turndown(html),
    state: 'ready',
    error: '',
  };
}

function switchSlugMode(mode: 'auto' | 'manual') {
  if (mode === 'manual' && slugMode.value === 'auto') {
    for (const it of items.value) {
      if (!it.slug) it.slug = slugify(it.title);
    }
  }
  slugMode.value = mode;
}

function removeItem(i: number) {
  items.value.splice(i, 1);
}

function clearAll() {
  items.value = [];
}

async function submitAll() {
  if (collectionId.value === null) {
    emit('notify', '请先选择文集', true);
    return;
  }
  const pending = items.value.filter((it) => it.state !== 'done');
  if (pending.length === 0) {
    emit('notify', '没有可导入的条目', true);
    return;
  }
  importing.value = true;
  let ok = 0;
  let fail = 0;
  const CHUNK = 50;
  for (let start = 0; start < pending.length; start += CHUNK) {
    const chunk = pending.slice(start, start + CHUNK);
    try {
      const results = await api.batchPosts({
        action: 'create',
        collection_id: collectionId.value,
        posts: buildImportPayloads(chunk, slugMode.value, collectionId.value, status.value),
      });
      if (!results.results) {
        throw new Error('批量导入接口返回异常');
      }
      results.results.forEach((r, i) => {
        const item = chunk[i];
        if (!item) return;
        if (r.ok && r.post) {
          item.state = 'done';
          item.slug = r.post.slug;
          importedIds.value.push(r.post.id);
          ok++;
        } else {
          item.state = 'failed';
          item.error = r.error ?? '导入失败';
          fail++;
        }
      });
      // 持久化导入 ID
      localStorage.setItem(IMPORTED_IDS_KEY, JSON.stringify(importedIds.value));
    } catch (e) {
      for (const item of chunk) {
        item.state = 'failed';
        item.error = (e as Error).message;
        fail++;
      }
    }
  }
  importing.value = false;
  // 持久化导入成功的 ID
  const successIds = items.value
    .filter((it) => it.state === 'done')
    .map((it) => {
      // 从 items 中找 post id — 需要从 batch 结果反向映射
      return null as number | null;
    })
    .filter((id): id is number => id !== null);
  // 实际上 batch API 返回的 post id 在 results 中，需要从循环中收集
  emit('notify', `导入完成：成功 ${ok} 篇，失败 ${fail} 篇`, fail > 0);
}

async function generateAiSummaries() {
  if (generatingAi.value || importedIds.value.length === 0) return;
  generatingAi.value = true;
  aiResults.value = {};
  const CHUNK = 5;
  for (let start = 0; start < importedIds.value.length; start += CHUNK) {
    const chunk = importedIds.value.slice(start, start + CHUNK);
    try {
      const res = await api.aiBatchSummary(chunk);
      for (const r of res.results) {
        aiResults.value[r.id] = r.status;
        if (r.status === 'failed') {
          emit('notify', `文章 #${r.id} 摘要生成失败：${r.error ?? '未知错误'}`, true);
        }
      }
    } catch (e) {
      emit('notify', `批量摘要出错：${(e as Error).message}`, true);
    }
  }
  generatingAi.value = false;
  emit('notify', 'AI 摘要批量生成完成');
}
</script>

<template>
  <PageHead kicker="导 入" title="批量导入" />

  <div class="card">
    <div class="card-head">
      <h2>选择文件与设置</h2>
    </div>
    <div class="form-row form-row-3">
      <div class="field field-full">
        <label>源文件（.md / .txt / .docx，可多选）</label>
        <div
          class="dropzone"
          :class="{ 'is-active': dragActive }"
          role="button"
          tabindex="0"
          aria-label="把文件拖到这里，或点击选择文件"
          @click="pickFiles"
          @keydown.enter.prevent="pickFiles"
          @keydown.space.prevent="pickFiles"
          @dragenter="onDragEnter"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <span class="dropzone-icon" aria-hidden="true">⇪</span>
          <span class="dropzone-title">{{ dragActive ? '松手即加入清单' : '把文件拖到这里，或点此选择' }}</span>
          <span class="dropzone-sub">支持 .md / .markdown / .txt / .docx，可一次拖入多个</span>
          <input
            ref="fileInput"
            class="dropzone-input"
            type="file"
            accept=".md,.markdown,.txt,.docx"
            multiple
            @change="onFiles"
          />
        </div>
        <span class="hint">
          Markdown 与纯文本直接读取；Word 文档自动识别排版（标题、段落、列表、引用、代码块、图片），转换为 Markdown
          后导入
        </span>
      </div>
      <div class="field">
        <label>归入文集</label>
        <select v-model="collectionId" class="select">
          <option :value="null" disabled>请选择文集</option>
          <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
        </select>
      </div>
      <div class="field">
        <label>导入状态</label>
        <div class="row">
          <button
            class="btn btn-ghost mini"
            :style="status === 'draft' ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
            @click="status = 'draft'"
          >
            草稿
          </button>
          <button
            class="btn btn-ghost mini"
            :style="status === 'published' ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
            @click="status = 'published'"
          >
            已刊
          </button>
        </div>
      </div>
      <div class="field">
        <label>slug 生成方式</label>
        <div class="row">
          <button
            class="btn btn-ghost mini"
            :style="slugMode === 'auto' ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
            @click="switchSlugMode('auto')"
          >
            自动生成
          </button>
          <button
            class="btn btn-ghost mini"
            :style="slugMode === 'manual' ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
            @click="switchSlugMode('manual')"
          >
            手动输入
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="card" v-if="items.length">
    <div class="card-head">
      <h2>待导入清单（{{ items.length }} 篇）</h2>
      <div class="row">
        <button class="btn btn-ghost mini" :disabled="importing" @click="clearAll">清空</button>
        <button class="btn btn-primary" :disabled="importing || collectionId === null" @click="submitAll">
          {{ importing ? '导入中…' : '全部导入' }}
        </button>
      </div>
    </div>
    <div v-if="importedIds.length > 0" class="import-bar">
      <span class="text-muted-sm">已导入 {{ importedIds.length }} 篇</span>
      <button class="btn btn-ghost mini" :disabled="generatingAi" @click="generateAiSummaries">
        {{ generatingAi ? '生成中…' : 'AI 生成摘要' }}
      </button>
      <span v-if="Object.keys(aiResults).length" class="text-muted-xs">
        {{ Object.values(aiResults).filter((s) => s === 'generated').length }} 篇成功，
        {{ Object.values(aiResults).filter((s) => s === 'failed').length }} 篇失败
      </span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>来源</th>
            <th class="col-min-180">标题</th>
            <th class="col-min-150">slug</th>
            <th>摘要</th>
            <th>状态</th>
            <th class="ta-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in items" :key="item.file + i">
            <td class="file-cell">{{ item.file }}</td>
            <td>
              <input v-model="item.title" class="input compact" />
            </td>
            <td>
              <input
                v-if="slugMode === 'auto'"
                :value="slugify(item.title)"
                class="input compact is-readonly-input"
                readonly
              />
              <input v-else v-model="item.slug" class="input compact" />
            </td>
            <td>
              <input v-model="item.summary" class="input compact" :title="item.summary" />
            </td>
            <td>
              <span v-if="item.state === 'done'" class="tag tag-published">完成</span>
              <span v-else-if="item.state === 'failed'" class="tag tag-draft" :title="item.error">失败</span>
              <span v-else class="tag">待导入</span>
            </td>
            <td class="ta-right">
              <button class="btn btn-danger mini" :disabled="importing" @click="removeItem(i)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="items.some((it) => it.state === 'failed')" class="empty empty-error">
      <div v-for="(item, i) in items" :key="'e' + i">
        <span v-if="item.state === 'failed'">「{{ item.file }}」失败：{{ item.error }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 28px 20px;
  border: 2px dashed var(--hairline);
  border-radius: var(--radius-lg, 10px);
  background: var(--paper-2, rgba(0, 0, 0, 0.015));
  color: var(--ink-light);
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}
.dropzone:hover,
.dropzone:focus-visible {
  border-color: var(--cinnabar);
  color: var(--ink-mid);
  outline: none;
}
.dropzone.is-active {
  border-color: var(--cinnabar);
  border-style: solid;
  background: color-mix(in srgb, var(--cinnabar) 8%, transparent);
  color: var(--cinnabar);
}
.dropzone-icon {
  font-size: 1.5rem;
  line-height: 1;
}
.dropzone-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-deep);
}
.dropzone.is-active .dropzone-title {
  color: var(--cinnabar);
}
.dropzone-sub {
  font-size: 0.78rem;
}
.dropzone-input {
  display: none;
}
</style>
