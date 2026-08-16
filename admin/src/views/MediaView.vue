<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { MediaFile } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const files = ref<MediaFile[]>([]);
const cursor = ref<string | undefined>(undefined);
const loaded = ref(false);
const busy = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/');
}

async function loadMore() {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await api.media(cursor.value);
    files.value.push(...res.files);
    cursor.value = res.cursor;
    loaded.value = true;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
  }
}

function reload() {
  files.value = [];
  cursor.value = undefined;
  loaded.value = false;
  return loadMore();
}

async function remove(f: MediaFile) {
  if (!confirm(`确要删除 ${f.key.split('/').pop()}？引用它的文章将裂图。`)) return;
  try {
    await api.deleteMedia(f.key);
    files.value = files.value.filter((x) => x.key !== f.key);
    emit('notify', '文件已删');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function copy(url: string, markdown = false) {
  try {
    const text = markdown ? `![图片](${url})` : url;
    await navigator.clipboard.writeText(text);
    emit('notify', markdown ? '已复制 Markdown 引用' : '链接已复制');
  } catch {
    emit('notify', '复制失败', true);
  }
}

async function onUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    await api.upload(file);
    emit('notify', '已上传');
    await reload();
  } catch (err) {
    emit('notify', (err as Error).message, true);
  } finally {
    uploading.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

onMounted(loadMore);
</script>

<template>
  <div class="page-head">
    <span class="kicker">媒 体</span>
    <h1>笔墨相册</h1>
  </div>

  <div class="card pad">
    <div class="card-head" style="border:none;padding:0 0 16px;">
      <button class="btn btn-primary" :disabled="uploading" @click="fileInput?.click()">
        {{ uploading ? '上传中…' : '上传图片' }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="onUpload" />
      <span style="color:var(--ink-light);font-size:0.82rem;">共 {{ files.length }} 张{{ cursor ? '+' : '' }}（旧→新）</span>
    </div>

    <div v-if="files.length" class="media-grid">
      <figure v-for="f in files" :key="f.key" class="media-card">
        <img :src="f.url" :alt="f.key" loading="lazy" />
        <figcaption>
          <span class="media-key" :title="f.key">{{ f.key.split('/').pop() }}</span>
          <span class="media-meta">{{ fmtSize(f.size) }} · {{ fmtDate(f.uploaded) }}</span>
          <div class="actions">
            <button class="btn btn-ghost mini" @click="copy(f.url)">复制链接</button>
            <button class="btn btn-ghost mini" @click="copy(f.url, true)">复制引用</button>
            <button class="btn btn-danger mini" @click="remove(f)">删</button>
          </div>
        </figcaption>
      </figure>
    </div>
    <div v-else-if="loaded" class="empty">相册尚空，传一张吧。</div>
    <div v-else class="empty">载入中…</div>

    <div style="text-align:center;padding-top:20px;" v-if="cursor">
      <button class="btn btn-ghost" :disabled="busy" @click="loadMore">
        {{ busy ? '载入中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}
.media-card {
  margin: 0;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  overflow: hidden;
  background: var(--paper-card);
  display: flex;
  flex-direction: column;
}
.media-card img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: #f1ece4;
}
.media-card figcaption {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.media-key {
  font-size: 0.78rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-meta {
  font-size: 0.75rem;
  color: var(--ink-light);
}
</style>