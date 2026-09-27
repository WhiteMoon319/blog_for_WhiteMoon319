<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
// 批量操作条：勾选后浮现，左侧是已选数量与清除，右侧由调用方给动作。
defineProps<{ count: number }>();
defineEmits<{ clear: [] }>();
</script>

<template>
  <div v-if="count > 0" class="batch-bar">
    <span class="batch-count">已选 <b>{{ count }}</b> 项</span>
    <button type="button" class="batch-clear" @click="$emit('clear')">取消选择</button>
    <span class="batch-spacer"></span>
    <slot />
  </div>
</template>

<style scoped>
.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--cinnabar) 6%, var(--paper-card));
  border-bottom: 1px solid var(--cinnabar-line);
}
.batch-count {
  font-size: 0.84rem;
  color: var(--ink-mid);
}
.batch-count b {
  color: var(--cinnabar);
}
.batch-clear {
  padding: 3px 8px;
  font: inherit;
  font-size: 0.78rem;
  color: var(--ink-light);
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  cursor: pointer;
}
.batch-clear:hover {
  color: var(--cinnabar);
  border-color: var(--cinnabar-line);
}
.batch-spacer {
  flex: 1 1 auto;
}
</style>
