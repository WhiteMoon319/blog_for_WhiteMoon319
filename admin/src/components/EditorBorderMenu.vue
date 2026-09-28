<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { BORDER_PRESETS, BORDER_TOGGLES, type TableBorder } from '../lib/table-borders.ts';

defineProps<{ borders: TableBorder[] }>();
defineEmits<{ preset: [value: string]; toggle: [value: TableBorder]; close: [] }>();
</script>

<template>
  <div class="border-menu" @mousedown.stop>
    <div class="border-menu-head">
      <strong>表格框线</strong>
      <button type="button" class="blk-x" title="收起" @click="$emit('close')">×</button>
    </div>
    <div class="border-menu-hint">点选逐边开关，或直接用预设</div>
    <div class="border-presets">
      <button v-for="p in BORDER_PRESETS" :key="p.value" type="button" @click="$emit('preset', p.value)">
        {{ p.label }}
      </button>
    </div>
    <div class="border-toggles">
      <button
        v-for="b in BORDER_TOGGLES"
        :key="b.value"
        type="button"
        :class="{ 'is-on': borders.includes(b.value) }"
        :title="`切换「${b.label}」框线`"
        @click="$emit('toggle', b.value)"
      >
        {{ b.label }}
      </button>
    </div>
    <div class="border-preview-wrap">
      <div class="border-preview" :class="borders.map((b) => `pv-${b}`)"><span /><span /><span /><span /></div>
      <span class="border-preview-label">示意</span>
    </div>
  </div>
</template>
