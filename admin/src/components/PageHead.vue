<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
// 页面头部骨架：眉题 + 标题（+ 可选说明），右侧是操作槽。
// 原先十个视图各写一份同样的标记，改一处要改十处。
defineProps<{
  /** 眉题，如「文 章」 */
  kicker: string;
  /** 页面标题 */
  title: string;
  /** 可选的一句话说明 */
  desc?: string;
}>();
</script>

<template>
  <div class="page-head">
    <div class="page-head-main">
      <span class="kicker">{{ kicker }}</span>
      <h1>{{ title }}</h1>
      <p v-if="desc" class="page-desc">{{ desc }}</p>
    </div>
    <div v-if="$slots.actions" class="head-actions">
      <slot name="actions" />
    </div>
    <div v-if="$slots.toolbar" class="head-toolbar">
      <slot name="toolbar" />
    </div>
  </div>
</template>
