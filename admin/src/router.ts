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
    { path: '/editor', name: 'editor', component: () => import('./views/PostEditorView.vue') },
  ],
});

export default router;