<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { api } from '../api';
import { authState, initAuth, setAuthed } from '../store/auth';

const toast = reactive({ msg: '', err: false });

function notify(msg: string, err = false) {
  toast.msg = msg;
  toast.err = err;
  setTimeout(() => (toast.msg = ''), 2600);
}

// 写作区的角色门：作者与管理员可用；读者与未登录一律请回登录页。
// 这里只是体验层，真正的权限判定在接口层（requireAuthor + 归属/协作文集校验）。
function allowed(): boolean {
  return authState.authed && (authState.role === 'author' || authState.role === 'admin');
}

onMounted(async () => {
  window.addEventListener('auth:expired', () => {
    setAuthed(false, '');
    window.location.href = '/login/?redirect=/write/';
  });
  await initAuth();
  if (!authState.authed) {
    window.location.href = '/login/?redirect=/write/';
  } else if (!allowed()) {
    window.location.href = '/404';
  }
});

async function logout() {
  try {
    await api.logout();
  } finally {
    setAuthed(false, '');
    window.location.href = '/login/?redirect=/write/';
  }
}
</script>

<template>
  <div v-if="authState.checking" class="login-wrap">
    <div class="seal" style="width:48px;height:48px;font-size:1.4rem;display:grid;place-items:center;border-radius:6px;background:var(--cinnabar);color:#fff;">墨</div>
  </div>

  <template v-else-if="allowed()">
    <nav class="admin-nav">
      <a class="admin-brand" href="/write/">
        <span class="seal">墨</span>
        <span>书斋写作区</span>
      </a>
      <div class="admin-links">
        <router-link to="/">我的文章</router-link>
        <router-link to="/editor">写新篇</router-link>
        <router-link to="/collections">我的文集</router-link>
        <router-link to="/media">媒体</router-link>
      </div>
      <span class="spacer"></span>
      <a v-if="authState.role === 'admin'" class="nav-ghost" href="/admin/">后台</a>
      <a class="nav-ghost" href="/" target="_blank">查看前台</a>
      <button class="nav-ghost" @click="logout">退出</button>
    </nav>

    <main class="admin-main">
      <router-view @notify="notify" />
    </main>
  </template>

  <Transition name="toast">
    <div v-if="toast.msg" class="toast" :class="{ err: toast.err }">{{ toast.msg }}</div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s var(--ease), transform 0.25s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
