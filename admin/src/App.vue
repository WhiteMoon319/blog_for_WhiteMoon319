<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api';
import { authState, initAuth, setAuthed } from './store/auth';
import AdminNav, { type NavGroup } from './components/NavBar.vue';

// 导航按用途分组：平铺 12 项在中等宽度下会折行，分组后顶层只剩 4 个控件
const NAV_GROUPS: NavGroup[] = [
  {
    label: '写作',
    items: [
      { to: '/collections', text: '文集' },
      { to: '/posts', text: '文章' },
      { to: '/pages', text: '页面' },
      { to: '/media', text: '媒体' },
    ],
  },
  {
    label: '管理',
    items: [
      { to: '/comments', text: '评论' },
      { to: '/users', text: '用户' },
    ],
  },
  {
    label: '配置',
    items: [
      { to: '/import', text: '导入' },
      { to: '/export', text: '导出' },
      { to: '/settings', text: '设置' },
    ],
  },
];

const route = useRoute();
const router = useRouter();

const toast = reactive({ msg: '', err: false });

function notify(msg: string, err = false) {
  toast.msg = msg;
  toast.err = err;
  setTimeout(() => (toast.msg = ''), 2600);
}

// 路由守卫：首次进入时鉴权尚未完成，必须在守卫内等待而不是直接拦下——
// 直接 return false 会取消初始导航，且之后无人再触发，页面会停在空白。
router.beforeEach(async (to) => {
  // 鉴权必须在守卫内完成（含登录页）：checking 未落定时整个 App 只会渲染加载态
  if (authState.checking) await initAuth();
  if (to.path === '/login') return true;
  if (!authState.authed) {
    window.location.href = '/login/?redirect=/admin/';
    return false;
  }
  if (authState.role !== 'admin') {
    // 作者有自己的写作区：不共用后台，避免靠隐藏菜单来做权限划分
    window.location.href = authState.role === 'author' ? '/write/' : '/404';
    return false;
  }
  return true;
});

watch(
  () => route.path,
  (path) => {
    if (path === '/login' && authState.authed) router.replace('/');
  },
);

onMounted(() => {
  window.addEventListener('auth:expired', () => {
    setAuthed(false, '');
    if (route.path !== '/login') window.location.href = '/login/?redirect=/admin/';
  });
});

async function logout() {
  try {
    await api.logout();
  } finally {
    setAuthed(false, '');
    window.location.href = '/login/?redirect=/admin/';
  }
}
</script>

<template>
  <div v-if="authState.checking" class="login-wrap">
    <div class="seal seal-lg">签</div>
  </div>

  <template v-else-if="authState.authed && route.path !== '/login'">
    <AdminNav
      seal="签"
      title="书斋后台"
      brand-href="/admin/"
      :flat="[{ to: '/', text: '工作台' }]"
      :groups="NAV_GROUPS"
    >
      <template #actions>
        <router-link class="nav-ghost nav-primary" to="/editor">写新篇</router-link>
        <a class="nav-ghost" href="/" target="_blank">查看前台</a>
        <button class="nav-ghost" @click="logout">退出</button>
      </template>
    </AdminNav>

    <main class="admin-main">
      <router-view @notify="notify" />
    </main>

    <nav class="mob-tabbar" aria-label="常用功能">
      <router-link to="/" aria-label="工作台">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />
        </svg>
        <span>工作台</span>
      </router-link>
      <router-link to="/editor" aria-label="写新篇">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
          <path d="m14.8 6.4 3 3" />
        </svg>
        <span>写作</span>
      </router-link>
      <router-link to="/posts" aria-label="文章管理">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M14 3v5h5M9 12h7M9 16h7" />
        </svg>
        <span>文章</span>
      </router-link>
      <router-link to="/comments" aria-label="评论管理">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9Z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
        <span>评论</span>
      </router-link>
      <router-link to="/settings" aria-label="站点设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7l-.7-2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7l-2 .7v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7l2-.7Z"
          />
        </svg>
        <span>设置</span>
      </router-link>
    </nav>
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
