// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/collections', name: 'collections', component: () => import('./views/CollectionsView.vue') },
    { path: '/posts', name: 'posts', component: () => import('./views/PostsView.vue') },
    { path: '/media', name: 'media', component: () => import('./views/MediaView.vue') },
    { path: '/import', name: 'import', component: () => import('./views/ImportView.vue') },
    { path: '/export', name: 'export', component: () => import('./views/ExportView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/pages', name: 'pages', component: () => import('./views/PagesView.vue') },
    { path: '/stats', name: 'stats', component: () => import('./views/StatsView.vue') },
    { path: '/comments', name: 'comments', component: () => import('./views/CommentsView.vue') },
    { path: '/editor', name: 'editor', component: () => import('./views/PostEditorView.vue') },
  ],
});

export default router;