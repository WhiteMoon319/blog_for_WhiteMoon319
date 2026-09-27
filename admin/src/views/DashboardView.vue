<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import StatsPanels from '../components/StatsPanels.vue';
import PageHead from '../components/PageHead.vue';

const stats = ref({ collections: 0, published: 0, drafts: 0 });
const loaded = ref(false);

onMounted(async () => {
  try {
    const [cols, posts] = await Promise.all([api.collections(), api.posts()]);
    stats.value = {
      collections: cols.collections.length,
      published: posts.posts.filter((p) => p.status === 'published').length,
      drafts: posts.posts.filter((p) => p.status === 'draft').length,
    };
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <PageHead kicker="工 作 台" title="主人书案">
    <template #actions>
      <router-link class="btn btn-primary" to="/editor">写新篇</router-link>
      <router-link class="btn btn-ghost" to="/posts">管文章</router-link>
    </template>
  </PageHead>

  <p class="panel-title">内容概览</p>

  <div v-if="loaded" class="stat-grid">
    <div class="card stat-card pc-cinnabar">
      <div class="num">{{ stats.collections }}</div>
      <div class="label">文 集</div>
    </div>
    <div class="card stat-card pc-pine">
      <div class="num">{{ stats.published }}</div>
      <div class="label">已 刊 篇 目</div>
    </div>
    <div class="card stat-card pc-amber">
      <div class="num">{{ stats.drafts }}</div>
      <div class="label">未 竟 之 稿</div>
    </div>
  </div>

  <StatsPanels />
</template>