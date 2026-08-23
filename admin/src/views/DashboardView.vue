<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

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
  <div class="page-head">
    <span class="kicker">工 作 台</span>
    <h1>主人书案</h1>
  </div>

  <div v-if="loaded" class="stat-grid">
    <div class="card stat-card" style="--pc: var(--cinnabar);">
      <div class="num">{{ stats.collections }}</div>
      <div class="label">文 集</div>
    </div>
    <div class="card stat-card" style="--pc: var(--pine);">
      <div class="num">{{ stats.published }}</div>
      <div class="label">已 刊 篇 目</div>
    </div>
    <div class="card stat-card" style="--pc: var(--amber);">
      <div class="num">{{ stats.drafts }}</div>
      <div class="label">未 竟 之 稿</div>
    </div>
  </div>

  <div class="card pad" style="margin-top:20px;">
    <p style="font-family:var(--font-serif);color:var(--ink-mid);line-height:2;margin:0 0 18px;">
      于此间可新建文集、撰写文章、传图配文。写就的篇章可先置草稿，静观后刊发。
    </p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <router-link class="btn btn-primary" to="/editor">写新篇</router-link>
      <router-link class="btn btn-ghost" to="/collections">理文集</router-link>
      <router-link class="btn btn-ghost" to="/posts">管文章</router-link>
    </div>
  </div>
</template>