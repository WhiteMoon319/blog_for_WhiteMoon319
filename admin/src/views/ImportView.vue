<script setup lang="ts">
import { onMounted, ref } from 'vue';
import TurndownService from 'turndown';
import { api } from '../api';
import { buildImportPayloads, slugify } from '../lib/import';
import type { Collection } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface ImportItem {
  file: string;
  title: string;
  slug: string;
  summary: string;
  contentMd: string;
  state: 'ready' | 'importing' | 'done' | 'failed';
  error: string;
}

const collections = ref<Collection[]>([]);
const items = ref<ImportItem[]>([]);
const importing = ref(false);
const collectionId = ref<number | null>(null);
const status = ref<'draft' | 'published'>('draft');
const slugMode = ref<'auto' | 'manual'>('auto');
const fileInput = ref<HTMLInputElement | null>(null);

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });

const EXT_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

onMounted(async () => {
  try {
    const c = await api.collections();
    collections.value = c.collections;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
});

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

function titleFromMarkdown(md: string, fallback: string): string {
  const h = md.match(/^\s*#{1,6}\s+(.+)$/m);
  if (h) return h[1].replace(/[*_`]/g, '').trim();
  return fallback;
}

function summaryFromMarkdown(md: string): string {
  const para = md
    .split(/\n{2,}/)
    .map((p) => p.replace(/^[#>\-*+\d.\s`]+/m, '').replace(/[*_`[\]]/g, '').trim())
    .find((t) => t.length > 0);
  return (para ?? '').slice(0, 120);
}

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|>\s|```|`[^`\n]+`|\d+\.\s)/.test(text);
}

function plainToParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, '\n').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

function firstHeadingFromHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h = doc.querySelector('h1, h2, h3');
  return h?.textContent?.trim() || null;
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  for (const file of files) {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!['md', 'markdown', 'txt', 'docx'].includes(ext)) {
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
    const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? name;
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
          ok++;
        } else {
          item.state = 'failed';
          item.error = r.error ?? '导入失败';
          fail++;
        }
      });
    } catch (e) {
      for (const item of chunk) {
        item.state = 'failed';
        item.error = (e as Error).message;
        fail++;
      }
    }
  }
  importing.value = false;
  emit('notify', `导入完成：成功 ${ok} 篇，失败 ${fail} 篇`, fail > 0);
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">导 入</span>
    <h1>批量导入</h1>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>选择文件与设置</h2>
    </div>
    <div class="form-row" style="grid-template-columns: repeat(3, 1fr);">
      <div class="field" style="grid-column: 1 / -1;">
        <label>源文件（.md / .txt / .docx，可多选）</label>
        <input ref="fileInput" type="file" accept=".md,.markdown,.txt,.docx" multiple @change="onFiles" />
        <span class="hint">
          Markdown 与纯文本直接读取；Word 文档自动识别排版（标题、段落、列表、引用、代码块、图片），转换为 Markdown 后导入
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
        <div style="display: flex; gap: 8px;">
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
        <div style="display: flex; gap: 8px;">
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
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-ghost mini" :disabled="importing" @click="clearAll">清空</button>
        <button class="btn btn-primary" :disabled="importing || collectionId === null" @click="submitAll">
          {{ importing ? '导入中…' : '全部导入' }}
        </button>
      </div>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>来源</th>
          <th style="min-width: 180px;">标题</th>
          <th style="min-width: 150px;">slug</th>
          <th>摘要</th>
          <th>状态</th>
          <th style="text-align: right;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in items" :key="item.file + i">
          <td style="white-space: nowrap; color: var(--ink-light); font-size: 0.8rem;">{{ item.file }}</td>
          <td>
            <input v-model="item.title" class="input" style="padding: 6px 10px; font-size: 0.85rem;" />
          </td>
          <td>
            <input
              v-if="slugMode === 'auto'"
              :value="slugify(item.title)"
              class="input"
              readonly
              style="padding: 6px 10px; font-size: 0.85rem; background: transparent;"
            />
            <input
              v-else
              v-model="item.slug"
              class="input"
              style="padding: 6px 10px; font-size: 0.85rem;"
            />
          </td>
          <td>
            <input
              v-model="item.summary"
              class="input"
              style="padding: 6px 10px; font-size: 0.85rem;"
              :title="item.summary"
            />
          </td>
          <td>
            <span v-if="item.state === 'done'" class="tag tag-published">完成</span>
            <span v-else-if="item.state === 'failed'" class="tag tag-draft" :title="item.error">失败</span>
            <span v-else-if="item.state === 'importing'" class="tag">导入中</span>
            <span v-else class="tag">待导入</span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-danger mini" :disabled="importing" @click="removeItem(i)">移除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="items.some((it) => it.state === 'failed')" class="empty" style="text-align: left; color: var(--cinnabar);">
      <div v-for="(item, i) in items" :key="'e' + i">
        <span v-if="item.state === 'failed'">「{{ item.file }}」失败：{{ item.error }}</span>
      </div>
    </div>
  </div>
</template>