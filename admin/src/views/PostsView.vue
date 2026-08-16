<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import type { Collection, Post } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();
const route = useRoute();
const router = useRouter();

const posts = ref<Post[]>([]);
const collections = ref<Collection[]>([]);
const loaded = ref(false);
const filter = ref<'all' | 'published' | 'draft'>('all');
const filterCol = ref<number | ''>('');

async function load() {
  const [p, c] = await Promise.all([api.posts(), api.collections()]);
  posts.value = p.posts;
  collections.value = c.collections;
  loaded.value = true;
}
onMounted(load);

const shown = computed(() =>
  posts.value.filter((p) => {
    if (filter.value !== 'all' && p.status !== filter.value) return false;
    if (filterCol.value !== '' && p.collection_id !== filterCol.value) return false;
    return true;
  }),
);

function colName(id: number | null): string {
  return collections.value.find((c) => c.id === id)?.title ?? '未分类';
}

function colColor(id: number | null): string {
  return collections.value.find((c) => c.id === id)?.theme_color ?? '#8a6d3b';
}

function postUrl(p: Post): string {
  const col = collections.value.find((c) => c.id === p.collection_id);
  return col ? `/collections/${encodeURI(col.slug)}/${encodeURI(p.slug)}/` : `/posts/${encodeURI(p.slug)}/`;
}

function fmt(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/');
}

function edit(p: Post) {
  router.push({ path: '/editor', query: { id: p.id } });
}

function create() {
  router.push({ path: '/editor', query: filterCol.value !== '' ? { collection: filterCol.value } : {} });
}

async function toggleStatus(p: Post) {
  const next = p.status === 'published' ? 'draft' : 'published';
  try {
    await api.updatePost(p.id, { status: next });
    p.status = next;
    emit('notify', next === 'published' ? '已刊发' : '已撤为草稿');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function remove(p: Post) {
  if (!confirm(`确要焚毁「${p.title}」？不可复原。`)) return;
  try {
    await api.deletePost(p.id);
    emit('notify', '文章已删');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

const selected = ref<Set<number>>(new Set());
const busy = ref(false);
const moveCol = ref<number | ''>('');

function toggleAll() {
  const all = shown.value.map((p) => p.id);
  selected.value =
    shown.value.length > 0 && shown.value.every((p) => selected.value.has(p.id))
      ? new Set()
      : new Set(all);
}

async function bulk(action: 'publish' | 'draft' | 'delete' | 'move') {
  const ids = [...selected.value];
  if (ids.length === 0) return;
  if (action === 'delete' && !confirm(`确要焚毁选中的 ${ids.length} 篇？不可复原。`)) return;
  if (action === 'move' && moveCol.value === '') {
    emit('notify', '请先选择目标文集', true);
    return;
  }
  busy.value = true;
  try {
    const { count } = await api.batchPosts({
      action,
      ids,
      collection_id: action === 'move' ? moveCol.value : undefined,
    });
    selected.value = new Set();
    emit('notify', `已处理 ${count} 篇`);
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">文 章</span>
    <h1>篇目总览</h1>
  </div>

  <div class="card" v-if="loaded">
    <div class="card-head">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button
          v-for="f in (['all', 'published', 'draft'] as const)"
          :key="f"
          class="btn btn-ghost mini"
          :style="filter === f ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
          @click="filter = f"
        >
          {{ f === 'all' ? '全部' : f === 'published' ? '已刊' : '草稿' }}
        </button>
        <select v-model="filterCol" class="select" style="width:auto;padding:6px 10px;font-size:0.8rem;">
          <option :value="''">全部文集</option>
          <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
        </select>
      </div>
      <button class="btn btn-primary" @click="create">写新篇</button>
    </div>

    <div class="bulk-bar" v-if="selected.size > 0">
      <span style="color:var(--ink-light);font-size:0.85rem;">已选 {{ selected.size }} 篇</span>
      <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('publish')">批量刊发</button>
      <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('draft')">批量撤稿</button>
      <select v-model="moveCol" class="select" style="width:auto;padding:4px 8px;font-size:0.78rem;">
        <option :value="''">移入文集…</option>
        <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
      </select>
      <button class="btn btn-ghost mini" :disabled="busy || moveCol === ''" @click="bulk('move')">移动</button>
      <span style="flex:1"></span>
      <button class="btn btn-danger mini" :disabled="busy" @click="bulk('delete')">批量删除</button>
    </div>

    <table class="table" v-if="shown.length">
      <thead>
        <tr>
          <th style="width:32px;">
            <input
              type="checkbox"
              :checked="shown.length > 0 && shown.every((p) => selected.has(p.id))"
              @change="toggleAll"
            />
          </th>
          <th>篇名</th>
          <th>文集</th>
          <th>状态</th>
          <th>阅读</th>
          <th>日期</th>
          <th style="text-align:right;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in shown" :key="p.id">
          <td>
            <input
              type="checkbox"
              :checked="selected.has(p.id)"
              @change="selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id)"
            />
          </td>
          <td class="title-cell">
            <router-link
              v-if="p.status === 'draft'"
              :to="{ path: '/editor', query: { id: p.id } }"
              style="color:var(--ink-deep);text-decoration:none;"
            >
              {{ p.title }}
            </router-link>
            <a
              v-else
              :href="postUrl(p)"
              target="_blank"
              rel="noopener"
              style="color:var(--ink-deep);text-decoration:none;"
            >
              {{ p.title }}
            </a>
          </td>
          <td>
            <span class="color-dot" :style="{ background: colColor(p.collection_id) }"></span>
            {{ colName(p.collection_id) }}
          </td>
          <td>
            <span class="tag" :class="p.status === 'published' ? 'tag-published' : 'tag-draft'">
              {{ p.status === 'published' ? '已刊' : '草稿' }}
            </span>
          </td>
          <td style="color:var(--ink-light);font-size:0.82rem;">{{ p.view_count ?? 0 }}</td>
          <td style="color:var(--ink-light);font-size:0.82rem;">{{ fmt(p.created_at) }}</td>
          <td>
            <div class="actions">
              <button class="btn btn-ghost mini" @click="edit(p)">改</button>
              <button class="btn btn-ghost mini" @click="toggleStatus(p)">
                {{ p.status === 'published' ? '撤稿' : '刊发' }}
              </button>
              <button class="btn btn-danger mini" @click="remove(p)">删</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">此间无文。</div>
  </div>
</template>