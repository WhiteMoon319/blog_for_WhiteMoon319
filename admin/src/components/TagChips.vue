<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  modelValue: string[];
  suggestions?: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const draft = ref('');
const listId = `tag-suggest-${Math.random().toString(36).slice(2, 8)}`;

function add() {
  const text = draft.value.trim().replace(/\s+/g, ' ');
  if (text && !props.modelValue.includes(text)) {
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
</script>

<template>
  <div class="tag-chips">
    <span v-for="t in modelValue" :key="t" class="tag-chip-item" :title="`移除「${t}」`" @click="remove(t)">
      {{ t }}<span class="tag-chip-x">×</span>
    </span>
    <input
      v-model="draft"
      class="input tag-chip-input"
      :placeholder="placeholder ?? '回车添加标签'"
      :list="listId"
      @keydown="onKeydown"
      @blur="add"
    />
    <datalist :id="listId">
      <option v-for="s in suggestions ?? []" :key="s" :value="s">{{ s }}</option>
    </datalist>
  </div>
</template>
