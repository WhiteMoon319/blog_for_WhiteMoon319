<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api';
import { authState, initAuth, setAuthed } from './store/auth';

const route = useRoute();
const router = useRouter();

const toast = reactive({ msg: '', err: false });

function notify(msg: string, err = false) {
  toast.msg = msg;
  toast.err = err;
  setTimeout(() => (toast.msg = ''), 2600);
}

watch(
  () => route.path,
  (path) => {
    if (path === '/login' && authState.authed) router.replace('/');
  },
);

onMounted(async () => {
  window.addEventListener('auth:expired', () => {
    setAuthed(false);
    if (route.path !== '/login') router.push('/login');
  });
  await initAuth();
  if (!authState.authed && route.path !== '/login') router.push('/login');
});

async function logout() {
  try {
    await api.logout();
  } finally {
    setAuthed(false);
    router.push('/login');
  }
}
</script>

<template>
  <div v-if="authState.checking" class="login-wrap">
    <div class="seal" style="width:48px;height:48px;font-size:1.4rem;display:grid;place-items:center;border-radius:6px;background:var(--cinnabar);color:#fff;">签</div>
  </div>

  <template v-else-if="authState.authed && route.path !== '/login'">
    <nav class="admin-nav">
      <a class="admin-brand" href="/admin/">
        <span class="seal">签</span>
        <span>书斋后台</span>
      </a>
      <div class="admin-links">
        <router-link to="/">工作台</router-link>
        <router-link to="/collections">文集</router-link>
        <router-link to="/posts">文章</router-link>
        <router-link to="/media">媒体</router-link>
        <router-link to="/import">导入</router-link>
        <router-link to="/pages">页面</router-link>
        <router-link to="/stats">数据</router-link>
        <router-link to="/export">导出</router-link>
        <router-link to="/settings">设置</router-link>
        <router-link to="/editor">写新篇</router-link>
      </div>
      <span class="spacer"></span>
      <a class="nav-ghost" href="/" target="_blank">查看前台</a>
      <button class="nav-ghost" @click="logout">退出</button>
    </nav>

    <main class="admin-main">
      <router-view @notify="notify" />
    </main>
  </template>

  <template v-else-if="route.path === '/login'">
    <router-view @notify="notify" />
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