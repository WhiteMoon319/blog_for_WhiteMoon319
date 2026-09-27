<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { BLOCKS, BLOCK_GROUPS } from '../lib/blocks.ts';

defineEmits<{ insert: [name: string]; close: [] }>();
</script>

<template>
  <div class="blk-drawer">
    <div class="blk-drawer-head">
      <strong>排版素材</strong>
      <button type="button" class="blk-x" title="收起" @click="$emit('close')">×</button>
    </div>
    <p class="blk-drawer-hint">点一下插入，选中块后可切换外观。</p>
    <div v-for="g in BLOCK_GROUPS" :key="g" class="blk-group">
      <div class="blk-group-title">{{ g }}</div>
      <button
        v-for="b in BLOCKS.filter((x) => x.group === g && !x.hidden)"
        :key="b.name"
        type="button"
        class="blk-item"
        :title="b.hint"
        @click="$emit('insert', b.name)"
      >
        <span class="blk-item-name">{{ b.label }}</span>
        <span class="blk-item-hint">{{ b.hint }}</span>
      </button>
    </div>
  </div>
</template>
