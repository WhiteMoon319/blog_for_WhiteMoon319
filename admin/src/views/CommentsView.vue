<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

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
  <div class="page-head">
    <span class="kicker">评 论</span>
    <h1>评论审核</h1>
  </div>

  <div class="card">
    <div class="card-head" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button
        v-for="t in (['pending', 'approved', 'rejected'] as const)"
        :key="t"
        class="btn btn-ghost mini"
        :style="tab === t ? 'border-color:var(--cinnabar);color:var(--cinnabar);' : ''"
        @click="switchTab(t)"
      >
        {{ t === 'pending' ? '待审核' : t === 'approved' ? '已批准' : '已拒绝' }}
      </button>
      <span style="margin-left:auto;font-size:0.82rem;color:var(--ink-light);">共 {{ total }} 条</span>
      <span style="display:flex;gap:4px;align-items:center;">
        <input v-model.number="filterPostId" type="number" class="input" style="width:80px;padding:4px 8px;font-size:0.78rem;" placeholder="文章 ID" />
        <button class="btn btn-ghost mini" @click="searchByPost">筛选</button>
      </span>
    </div>

    <div class="table-wrap">
      <table class="table" v-if="comments.length">
        <thead>
          <tr>
            <th>文章</th>
            <th>用户</th>
            <th style="min-width:180px;">内容</th>
            <th>图片</th>
            <th>时间</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in comments" :key="c.id">
            <td style="font-size:0.8rem;">{{ c.post_title || `#${c.post_id}` }}</td>
            <td>{{ c.display_name || c.username }}</td>
            <td style="font-size:0.82rem;white-space:pre-wrap;">{{ c.body }}</td>
            <td>
              <span v-for="k in parseAttachments(c.attachments)" :key="k">
                <img :src="`/${k}`" class="comment-thumb" loading="lazy" />
              </span>
            </td>
            <td style="font-size:0.78rem;color:var(--ink-light);">{{ c.created_at.slice(0, 10) }}</td>
            <td>
              <div class="actions">
                <template v-if="tab === 'pending'">
                  <button class="btn btn-ghost mini" @click="moderate(c.id, 'approved')">通过</button>
                  <button class="btn btn-ghost mini" @click="moderate(c.id, 'rejected')">驳回</button>
                </template>
                <button class="btn btn-danger mini" @click="remove(c.id)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="loaded" class="empty">暂无评论。</div>
    </div>

    <div v-if="total > pageSize" style="padding:12px 16px;display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost mini" :disabled="page <= 1 || busy" @click="page--; load()">上一页</button>
      <span style="font-size:0.82rem;color:var(--ink-light);">{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
      <button class="btn btn-ghost mini" :disabled="page >= Math.ceil(total / pageSize) || busy" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>