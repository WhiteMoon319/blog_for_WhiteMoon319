<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { MAX_TAGS } from '../../../src/lib/utils.ts';

const props = defineProps<{
  modelValue: string[];
  suggestions?: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const draft = ref('');
const listId = `tag-suggest-${Math.random().toString(36).slice(2, 8)}`;

const atLimit = computed(() => props.modelValue.length >= MAX_TAGS);

function add() {
  const text = draft.value.trim().replace(/\s+/g, ' ');
  if (!text) {
    draft.value = '';
    return;
  }
  if (atLimit.value) {
    draft.value = '';
    return;
  }
  if (!props.modelValue.includes(text)) {
    emit('update:modelValue', [...props.modelValue, text]);
  }
  draft.value = '';
}

function remove(name: string) {
  emit('update:modelValue', props.modelValue.filter((n) => n !== name));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault();
    add();
  } else if (e.key === 'Backspace' && draft.value === '' && props.modelValue.length > 0) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}

// datalist 选择先触发 blur 再回填 input.value，直接 add 会把旧文本落进 chips；
// 延迟一拍等回填完成再提交
function onBlur() {
  setTimeout(add, 0);
}
</script>

<template>
  <div class="tag-chips">
    <span v-for="t in modelValue" :key="t" class="tag-chip-item" :title="`移除「${t}」`" @click="remove(t)">
      {{ t }}<span class="tag-chip-x">×</span>
    </span>
    <input
      v-model="draft"
      class="input tag-chip-input"
      :placeholder="atLimit ? `已达上限（${MAX_TAGS} 个）` : (placeholder ?? '回车添加标签')"
      :list="listId"
      :disabled="atLimit"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <span v-if="atLimit" class="hint" style="flex-basis:100%;">已达 {{ MAX_TAGS }} 个标签上限，移除后可继续添加。</span>
    <datalist :id="listId">
      <option v-for="s in suggestions ?? []" :key="s" :value="s">{{ s }}</option>
    </datalist>
  </div>
</template>
