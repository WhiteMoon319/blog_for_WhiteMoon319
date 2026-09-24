<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  bio: string;
  created_at: string;
}

const users = ref<UserRow[]>([]);
const loaded = ref(false);
const busy = ref(false);

async function load() {
  busy.value = true;
  try {
    const res = await api.users();
    users.value = res.users;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
    loaded.value = true;
  }
}

async function toggleBan(u: UserRow) {
  if (!confirm(`确要${u.status === 'active' ? '封禁' : '解封'}用户「${u.username}」？`)) return;
  try {
    await api.userBan(u.id);
    emit('notify', u.status === 'active' ? '已封禁' : '已解封');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

/** 提为作者 / 降回读者：只有这两个方向，管理员角色不在此列 */
async function setRole(u: UserRow, role: 'reader' | 'author') {
  const label = role === 'author' ? '提为作者' : '降为读者';
  const extra = role === 'author'
    ? '该作者可用同一登录入口进入后台，只能管理自己归属或署名的文章。'
    : '降回读者后，其后台入口与内容管理权限立即失效，已刊文章与署名保留。';
  if (!confirm(`确要${label}「${u.username}」？\n\n${extra}`)) return;
  try {
    await api.userRole(u.id, role);
    emit('notify', `已${label}`);
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function editBio(u: UserRow) {
  const next = prompt(`「${u.username}」的作者简介（留空即清除，最多 200 字）：`, u.bio ?? '');
  if (next === null) return;
  if (next.trim().length > 200) return emit('notify', '简介最长 200 字', true);
  try {
    await api.userProfile(u.id, { bio: next.trim() });
    emit('notify', '简介已更新');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <span class="kicker">用 户</span>
    <h1>用户管理</h1>
  </div>

  <div class="card">
    <div class="table-wrap">
      <table class="table" v-if="users.length">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>昵称</th>
            <th>简介</th>
            <th>邮箱</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.id }}</td>
            <td>{{ u.username }}</td>
            <td>{{ u.display_name }}</td>
            <td class="bio-cell">{{ u.bio }}</td>
            <td style="font-size:0.82rem;">{{ u.email }}</td>
            <td>
              <span class="tag" :class="u.role === 'admin' ? 'tag-published' : u.role === 'author' ? 'tag-published' : 'tag-draft'">
                {{ u.role === 'admin' ? '管理员' : u.role === 'author' ? '作者' : '读者' }}
              </span>
            </td>
            <td>
              <span :style="{ color: u.status === 'active' ? 'var(--ink-mid)' : 'var(--cinnabar)', fontSize: '0.82rem' }">
                {{ u.status === 'active' ? '正常' : '已封禁' }}
              </span>
            </td>
            <td style="font-size:0.78rem;color:var(--ink-light);">{{ u.created_at.slice(0, 10) }}</td>
            <td>
              <div class="actions">
                <button
                  v-if="u.role !== 'admin'"
                  class="btn btn-ghost mini"
                  :disabled="busy"
                  @click="setRole(u, u.role === 'author' ? 'reader' : 'author')"
                >
                  {{ u.role === 'author' ? '降为读者' : '提为作者' }}
                </button>
                <button class="btn btn-ghost mini" :disabled="busy" @click="editBio(u)">改简介</button>
                <button class="btn btn-danger mini" :disabled="u.role === 'admin'" @click="toggleBan(u)">
                  {{ u.status === 'active' ? '封禁' : '解封' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="loaded" class="empty">暂无用户。</div>
    </div>
  </div>
</template>

<style scoped>
.bio-cell {
  max-width: 220px;
  font-size: 0.8rem;
  color: var(--ink-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>