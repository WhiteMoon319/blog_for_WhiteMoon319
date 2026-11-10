<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { api } from '../api';
import { authState, initAuth, setAuthed } from '../store/auth';
import AdminNav from '../components/NavBar.vue';

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

/** 抽屉里的链接在 NavBar 内部也会收起；这里只兜底原生 <a> 跳转前的状态清理 */
function closeDrawer(): void {
  /* NavBar 监听 pointerdown 会在点击链接时自动收起抽屉，此处保留钩子以便后续扩展 */
}
</script>

<template>
  <div v-if="authState.checking" class="login-wrap">
    <div class="seal seal-lg">墨</div>
  </div>

  <template v-else-if="allowed()">
    <AdminNav
      seal="墨"
      title="书斋写作区"
      brand-href="/write/"
      :flat="[
        { to: '/', text: '我的文章' },
        { to: '/editor', text: '写新篇' },
        { to: '/collections', text: '我的文集' },
        { to: '/media', text: '媒体' },
      ]"
    >
      <template #actions>
        <a v-if="authState.role === 'admin'" class="nav-ghost" href="/admin/">后台</a>
        <a class="nav-ghost" href="/" target="_blank">查看前台</a>
        <button class="nav-ghost" @click="logout">退出</button>
      </template>
      <template #drawer-actions>
        <a v-if="authState.role === 'admin'" href="/admin/" @click="closeDrawer">后台</a>
        <a href="/" target="_blank">查看前台</a>
        <button type="button" class="drawer-logout" @click="logout">退出登录</button>
      </template>
    </AdminNav>

    <main class="admin-main">
      <router-view @notify="notify" />
    </main>

    <nav class="mob-tabbar" aria-label="写作区导航">
      <router-link to="/" aria-label="我的文章">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M14 3v5h5M9 12h7M9 16h7" />
        </svg>
        <span>我的文章</span>
      </router-link>
      <router-link to="/editor" aria-label="写新篇">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
          <path d="m14.8 6.4 3 3" />
        </svg>
        <span>写新篇</span>
      </router-link>
      <router-link to="/collections" aria-label="我的文集">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4 5a2 2 0 0 1 2-2h4v18H6a2 2 0 0 1-2-2V5Z" />
          <path d="M20 5a2 2 0 0 0-2-2h-4v18h4a2 2 0 0 0 2-2V5Z" />
        </svg>
        <span>文集</span>
      </router-link>
      <router-link to="/media" aria-label="媒体库">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m4 18 5-5 4 4 3-3 4 4" />
        </svg>
        <span>媒体</span>
      </router-link>
    </nav>
  </template>

  <Transition name="toast">
    <div v-if="toast.msg" class="toast" :class="{ err: toast.err }">{{ toast.msg }}</div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s var(--ease),
    transform 0.25s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
