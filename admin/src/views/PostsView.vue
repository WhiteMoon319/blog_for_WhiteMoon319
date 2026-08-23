<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { fmtDate } from '../lib/format';
import type { Collection, Post } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();
const route = useRoute();
const router = useRouter();

const posts = ref<Post[]>([]);
const collections = ref<Collection[]>([]);
const loaded = ref(false);
const filter = ref<'all' | 'published' | 'draft' | 'trash'>('all');
const filterCol = ref<number | ''>('');

async function load() {
  const [p, c] = await Promise.all([
    api.posts(filter.value === 'trash' ? '&trash=1' : ''),
    api.collections(),
  ]);
  posts.value = p.posts;
  collections.value = c.collections;
  loaded.value = true;
}
onMounted(() => {
  load().catch((e) => emit('notify', (e as Error).message, true));
});
watch(filter, () => {
  selected.value = new Set();
  moveCol.value = '';
  load().catch((e) => emit('notify', (e as Error).message, true));
});

const inTrash = computed(() => filter.value === 'trash');

const shown = computed(() =>
  posts.value.filter((p) => {
    if (filter.value !== 'all' && filter.value !== 'trash' && p.status !== filter.value) return false;
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

async function trash(p: Post) {
  if (!confirm(`把「${p.title}」移入回收站？可随时恢复。`)) return;
  try {
    await api.deletePost(p.id);
    emit('notify', '已移入回收站');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function restoreOne(p: Post) {
  try {
    const { count = 0 } = await api.batchPosts({ action: 'restore', ids: [p.id] });
    emit('notify', count > 0 ? '已恢复' : '该文章不在回收站');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function purgeOne(p: Post) {
  if (!confirm(`确要焚毁「${p.title}」？其版本历史与标签关联将一并清除，不可复原。`)) return;
  try {
    const { count = 0 } = await api.batchPosts({ action: 'purge', ids: [p.id] });
    emit('notify', count > 0 ? '已彻底删除' : '该文章不在回收站');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function togglePin(p: Post) {
  try {
    const { count = 0 } = await api.batchPosts({ action: p.is_pinned ? 'unpin' : 'pin', ids: [p.id] });
    emit('notify', count > 0 ? (p.is_pinned ? '已取消置顶' : '已置顶') : '无需变更');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

const selected = ref<Set<number>>(new Set());
const busy = ref(false);
const moveCol = ref<number | ''>('');
const aiId = ref<number | null>(null);

async function aiOne(p: Post) {
  if (aiId.value !== null) return;
  // 有非空摘要时确认覆盖
  if (p.summary?.trim() && !confirm(`「${p.title}」已有摘要，确要用 AI 重新生成并覆盖？`)) return;
  aiId.value = p.id;
  try {
    const res = await api.aiBatchSummary([p.id], true);
    const r = res.results[0];
    if (r?.status === 'generated') emit('notify', 'AI 摘要已更新');
    else if (r?.status === 'conflict') emit('notify', '摘要刚被修改，请重试', true);
    else emit('notify', r?.error ? `未生成：${r.error}` : '未生成', true);
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    aiId.value = null;
  }
}

function toggleAll() {
  const all = shown.value.map((p) => p.id);
  selected.value =
    shown.value.length > 0 && shown.value.every((p) => selected.value.has(p.id))
      ? new Set()
      : new Set(all);
}

async function bulk(action: 'publish' | 'draft' | 'delete' | 'trash' | 'restore' | 'purge' | 'move' | 'pin' | 'unpin') {
  const ids = [...selected.value];
  if (ids.length === 0) return;
  if (action === 'delete' && !confirm(`确要移入回收站选中的 ${ids.length} 篇？可随时恢复。`)) return;
  if (action === 'purge' && !confirm(`确要焚毁回收站中选中的 ${ids.length} 篇？不可复原！`)) return;
  if (action === 'move' && moveCol.value === '') {
    emit('notify', '请先选择目标文集', true);
    return;
  }
  busy.value = true;
  let done = 0;
  // 服务端单次批量 ≤50 篇且整批原子：客户端按 50 分块串行提交；
  // 任一请求失败立即停下并重新拉取列表，避免界面停留在半成功状态。
  const CHUNK = 50;
  try {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK);
      const { count = 0 } = await api.batchPosts({
        action,
        ids: chunk,
        collection_id: action === 'move' ? (moveCol.value === '' ? null : moveCol.value) : undefined,
      });
      done += count;
    }
    selected.value = new Set();
    emit('notify', `已处理 ${done} 篇`);
  } catch (e) {
    emit('notify', `${(e as Error).message}（已处理 ${done} 篇，列表已刷新）`, true);
  } finally {
    busy.value = false;
    await load();
  }
}

async function bulkAiSummary(force: boolean) {
  const ids = [...selected.value];
  if (ids.length === 0) return;
  // 非强制时检查是否有非空摘要的文章
  if (!force) {
    const hasSummary = ids.some((id) => {
      const p = posts.value.find((pp) => pp.id === id);
      return p && p.summary?.trim();
    });
    if (hasSummary && !confirm(`选中的文章中有已填写摘要的，AI 将跳过这些。\n\n如需强制覆盖全部摘要，请使用「强制覆盖」按钮。\n\n继续？`)) return;
  } else {
    if (!confirm(`将强制覆盖选中 ${ids.length} 篇文章的现有摘要（包括手工填写的内容）。\n\n是否继续？`)) return;
  }
  busy.value = true;
  let ok = 0;
  let fail = 0;
  const CHUNK = 5;
  try {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK);
      const res = await api.aiBatchSummary(chunk, force);
      for (const r of res.results) {
        if (r.status === 'generated') ok++;
        else if (r.status === 'failed') fail++;
      }
    }
    selected.value = new Set();
    emit('notify', `AI 摘要完成：成功 ${ok} 篇，跳过 ${ids.length - ok - fail} 篇，失败 ${fail} 篇`);
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
    await load();
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
          v-for="f in (['all', 'published', 'draft', 'trash'] as const)"
          :key="f"
          class="btn btn-ghost mini"
          :style="filter === f ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
          @click="filter = f"
        >
          {{ f === 'all' ? '全部' : f === 'published' ? '已刊' : f === 'draft' ? '草稿' : '回收站' }}
        </button>
        <select v-model="filterCol" class="select" style="width:auto;padding:6px 10px;font-size:0.8rem;">
          <option :value="''">全部文集</option>
          <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
        </select>
      </div>
      <button v-if="!inTrash" class="btn btn-primary" @click="create">写新篇</button>
    </div>

    <div class="bulk-bar" v-if="selected.size > 0">
      <span style="color:var(--ink-light);font-size:0.85rem;">已选 {{ selected.size }} 篇</span>
      <template v-if="!inTrash">
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('publish')">批量刊发</button>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('draft')">批量撤稿</button>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('pin')">置顶</button>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('unpin')">取消置顶</button>
        <select v-model="moveCol" class="select" style="width:auto;padding:4px 8px;font-size:0.78rem;">
          <option :value="''">移入文集…</option>
          <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
        </select>
        <button class="btn btn-ghost mini" :disabled="busy || moveCol === ''" @click="bulk('move')">移动</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('delete')">移入回收站</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulkAiSummary(false)">AI 摘要</button>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulkAiSummary(true)">AI 摘要（强制覆盖）</button>
      </template>
      <template v-else>
        <button class="btn btn-ghost mini" :disabled="busy" @click="bulk('restore')">恢复</button>
        <span style="flex:1"></span>
        <button class="btn btn-danger mini" :disabled="busy" @click="bulk('purge')">彻底删除</button>
      </template>
    </div>

    <div class="table-wrap">
      <table class="table posts-table" v-if="shown.length">
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
                v-if="!inTrash && p.status === 'draft'"
                :to="{ path: '/editor', query: { id: p.id } }"
                style="color:var(--ink-deep);text-decoration:none;"
              >
                {{ p.title }}
              </router-link>
              <a
                v-else-if="!inTrash"
                :href="postUrl(p)"
                target="_blank"
                rel="noopener"
                style="color:var(--ink-deep);text-decoration:none;"
              >
                {{ p.title }}
              </a>
              <span v-else style="color:var(--ink-light);">{{ p.title }}</span>
              <span v-if="!inTrash && p.is_pinned" class="tag tag-published" style="margin-left:6px;">置顶</span>
            </td>
            <td>
              <span class="color-dot" :style="{ background: colColor(p.collection_id) }"></span>
              {{ colName(p.collection_id) }}
            </td>
            <td>
              <span v-if="inTrash" class="tag tag-draft">已回收</span>
              <template v-else>
                <span class="tag" :class="p.status === 'published' ? 'tag-published' : 'tag-draft'">
                  {{ p.status === 'published' ? '已刊' : '草稿' }}
                </span>
                <span v-if="p.scheduled_at" class="tag tag-draft" style="margin-left:4px;">定 {{ fmtDate(p.scheduled_at) }}</span>
              </template>
            </td>
            <td style="color:var(--ink-light);font-size:0.82rem;">{{ p.view_count ?? 0 }}</td>
            <td style="color:var(--ink-light);font-size:0.82rem;">{{ fmtDate(p.deleted_at ?? p.created_at) }}</td>
            <td>
              <div class="actions">
                <template v-if="!inTrash">
                  <button class="btn btn-ghost mini" @click="edit(p)">改</button>
                  <button class="btn btn-ghost mini" @click="togglePin(p)">
                    {{ p.is_pinned ? '去顶' : '置顶' }}
                  </button>
                  <button class="btn btn-ghost mini" @click="toggleStatus(p)">
                    {{ p.status === 'published' ? '撤稿' : '刊发' }}
                  </button>
                  <button class="btn btn-ghost mini" :disabled="aiId === p.id" @click="aiOne(p)">
                    {{ aiId === p.id ? '生成中…' : (p.summary?.trim() ? 'AI 重写' : 'AI 摘要') }}
                  </button>
                  <button class="btn btn-danger mini" @click="trash(p)">回收</button>
                </template>
                <template v-else>
                  <button class="btn btn-ghost mini" @click="restoreOne(p)">恢复</button>
                  <button class="btn btn-danger mini" @click="purgeOne(p)">焚毁</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!shown.length" class="empty">{{ inTrash ? '回收站空空如也。' : '此间无文。' }}</div>
  </div>
</template>
