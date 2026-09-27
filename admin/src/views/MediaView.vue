<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import PageHead from '../components/PageHead.vue';
import RowActions from '../components/RowActions.vue';
import { authState } from '../store/auth';
import { fmtDate, fmtSize } from '../lib/format';
import type { MediaFile } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const files = ref<MediaFile[]>([]);
const cursor = ref<string | undefined>(undefined);
const loaded = ref(false);
const busy = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// gen 递增使旧请求结果作废：reload 时若仍有在途请求，避免旧数据覆盖/清空后的列表被补回
let gen = 0;

async function loadMore() {
  if (busy.value) return;
  busy.value = true;
  const myGen = gen;
  try {
    const res = await api.media(cursor.value);
    if (myGen !== gen) return;
    files.value.push(...res.files);
    cursor.value = res.cursor;
    loaded.value = true;
  } catch (e) {
    if (myGen === gen) emit('notify', (e as Error).message, true);
  } finally {
    if (myGen === gen) busy.value = false;
  }
}

function reload() {
  gen++;
  busy.value = false;
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
  <PageHead kicker="媒 体" title="笔墨相册">
    <template #actions>
      <button class="btn btn-primary" :disabled="uploading" @click="fileInput?.click()">
        {{ uploading ? '上传中…' : '上传图片' }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="onUpload" />
    </template>
  </PageHead>

  <div class="card pad">
    <div class="filter-bar filter-bar-tight">
      <span class="filter-count">共 {{ files.length }} 张{{ cursor ? '+' : '' }}（旧→新）</span>
    </div>

    <div v-if="files.length" class="media-grid">
      <figure v-for="f in files" :key="f.key" class="media-card">
        <img :src="f.url" :alt="f.key" loading="lazy" />
        <figcaption>
          <span class="media-key" :title="f.key">{{ f.key.split('/').pop() }}</span>
          <span class="media-meta">{{ fmtSize(f.size) }} · {{ fmtDate(f.uploaded) }}</span>
          <div class="actions">
            <RowActions
              :primary="{ label: '复制链接', run: () => copy(f.url) }"
              :items="[
                { label: '复制 Markdown 引用', run: () => copy(f.url, true) },
                ...(authState.role === 'admin'
                  ? [{ label: '删除图片', danger: true, run: () => remove(f) }]
                  : []),
              ]"
            />
          </div>
        </figcaption>
      </figure>
    </div>
    <div v-else-if="loaded" class="empty">相册尚空，传一张吧。</div>
    <div v-else class="empty">载入中…</div>

    <div class="load-more" v-if="cursor">
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