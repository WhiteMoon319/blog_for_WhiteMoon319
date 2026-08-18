<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { MediaFile } from '../types';

const emit = defineEmits<{
  close: [];
  notify: [msg: string, err?: boolean];
  pick: [url: string];
}>();

const files = ref<MediaFile[]>([]);
const cursor = ref<string | undefined>(undefined);
const busy = ref(false);

async function load() {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await api.media(cursor.value);
    files.value.push(...res.files);
    cursor.value = res.cursor;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});

function insert(url: string) {
  emit('pick', url);
}
</script>

<template>
  <div class="media-mask" @click.self="emit('close')">
    <div class="media-modal">
      <div class="media-modal-head">
        <span>从相册取图</span>
        <button class="btn btn-ghost mini" @click="emit('close')">关</button>
      </div>
      <div class="media-modal-body">
        <div v-if="files.length" class="media-modal-grid">
          <button v-for="f in files" :key="f.key" class="media-thumb" :title="f.key" @click="insert(f.url)">
            <img :src="f.url" :alt="f.key" loading="lazy" />
          </button>
        </div>
        <div v-else class="empty">相册空空…</div>
        <div v-if="cursor" style="text-align:center;padding-top:12px;">
          <button class="btn btn-ghost mini" :disabled="busy" @click="load">
            {{ busy ? '载入中…' : '加载更多' }}
          </button>
        </div>
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
</style>