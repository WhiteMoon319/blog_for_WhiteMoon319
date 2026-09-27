<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import PageHead from '../components/PageHead.vue';
import RowActions from '../components/RowActions.vue';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface AdminComment {
  id: number;
  post_id: number;
  body: string;
  attachments: string;
  status: string;
  created_at: string;
  username: string;
  display_name: string;
  post_title: string;
}

const tab = ref<'pending' | 'approved' | 'rejected'>('pending');
const comments = ref<AdminComment[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loaded = ref(false);
const busy = ref(false);
const filterPostId = ref<number | undefined>(undefined);

async function load() {
  busy.value = true;
  try {
    const res = await api.adminComments(tab.value, page.value, filterPostId.value);
    comments.value = res.comments;
    total.value = res.total;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
    loaded.value = true;
  }
}

function switchTab(t: 'pending' | 'approved' | 'rejected') {
  tab.value = t;
  page.value = 1;
  load();
}

function searchByPost() {
  page.value = 1;
  load();
}

function parseAttachments(att: string): string[] {
  try { const a = JSON.parse(att); return Array.isArray(a) ? a : []; } catch { return []; }
}

async function moderate(id: number, status: 'approved' | 'rejected') {
  try {
    await api.adminCommentUpdate(id, status);
    emit('notify', status === 'approved' ? '已批准' : '已驳回');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function remove(id: number) {
  if (!confirm('确认删除该评论？其下的回复将一并删除。')) return;
  try {
    await api.adminCommentDelete(id);
    emit('notify', '已删除');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

onMounted(load);
</script>

<template>
  <PageHead kicker="评 论" title="评论审核" />

  <div class="card">
    <div class="filter-bar">
      <div class="seg">
        <button
          v-for="t in (['pending', 'approved', 'rejected'] as const)"
          :key="t"
          class="btn btn-ghost mini"
          :class="{ active: tab === t }"
          @click="switchTab(t)"
        >
          {{ t === 'pending' ? '待审核' : t === 'approved' ? '已批准' : '已拒绝' }}
        </button>
      </div>
      <span class="post-filter">
        <input v-model.number="filterPostId" type="number" class="input filter-id" placeholder="文章 ID" />
        <button class="btn btn-ghost mini" @click="searchByPost">筛选</button>
      </span>
      <span class="filter-count">共 {{ total }} 条</span>
    </div>

    <div class="table-wrap">
      <table class="table" v-if="comments.length">
        <thead>
          <tr>
            <th>文章</th>
            <th>用户</th>
            <th class="col-min-180">内容</th>
            <th>图片</th>
            <th>时间</th>
            <th class="ta-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in comments" :key="c.id">
            <td class="muted-cell">{{ c.post_title || `#${c.post_id}` }}</td>
            <td>{{ c.display_name || c.username }}</td>
            <td class="comment-body">{{ c.body }}</td>
            <td>
              <span v-for="k in parseAttachments(c.attachments)" :key="k">
                <img :src="`/${k}`" class="comment-thumb" loading="lazy" />
              </span>
            </td>
            <td class="muted-cell date-cell">{{ c.created_at.slice(0, 10) }}</td>
            <td class="actions-cell">
              <RowActions
                :primary="
                  tab === 'pending'
                    ? { label: '通过', run: () => moderate(c.id, 'approved') }
                    : { label: '删除', danger: true, run: () => remove(c.id) }
                "
                :items="
                  tab === 'pending'
                    ? [
                        { label: '驳回', run: () => moderate(c.id, 'rejected') },
                        { label: '删除评论', danger: true, run: () => remove(c.id) },
                      ]
                    : []
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="loaded" class="empty">暂无评论。</div>
    </div>

    <div v-if="total > pageSize" class="table-foot">
      <span class="muted">第 {{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span>
      <div class="seg">
        <button class="btn btn-ghost mini" :disabled="page <= 1 || busy" @click="page--; load()">上一页</button>
        <button
          class="btn btn-ghost mini"
          :disabled="page >= Math.ceil(total / pageSize) || busy"
          @click="page++; load()"
        >
          下一页
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.post-filter {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.filter-id {
  width: 80px;
  padding: 4px 8px;
  font-size: 0.78rem;
}
.comment-body {
  font-size: 0.82rem;
  white-space: pre-wrap;
}
.date-cell {
  font-size: 0.78rem;
}
</style>