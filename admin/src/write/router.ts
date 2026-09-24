// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRouter, createWebHistory } from 'vue-router';

// 作者写作区的路由：只有内容相关页面，没有管理员后台的任何入口
const router = createRouter({
  history: createWebHistory('/write/'),
  routes: [
    { path: '/', name: 'posts', component: () => import('../views/PostsView.vue') },
    { path: '/editor', name: 'editor', component: () => import('../views/PostEditorView.vue') },
    { path: '/collections', name: 'collections', component: () => import('./WriteCollectionsView.vue') },
    { path: '/media', name: 'media', component: () => import('../views/MediaView.vue') },
  ],
});

export default router;
