<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
// 列表行操作：一个主操作 + 「更多 ▾」收纳低频项。
// 面板用 fixed 定位：表格容器是 overflow:auto，绝对定位的浮层会被裁掉。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface RowAction {
  label: string;
  /** 危险操作（回收站/焚毁）统一红色 */
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

defineProps<{
  /** 主操作，始终可见 */
  primary?: RowAction;
  /** 低频操作，收进「更多」 */
  items?: RowAction[];
}>();

const open = ref(false);
const moreBtn = ref<HTMLButtonElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

function openMenu(): void {
  const r = moreBtn.value?.getBoundingClientRect();
  if (r) {
    panelStyle.value = {
      top: `${Math.round(r.bottom + 6)}px`,
      right: `${Math.max(8, Math.round(window.innerWidth - r.right))}px`,
    };
  }
  open.value = true;
}

function run(action: RowAction): void {
  open.value = false;
  if (!action.disabled) action.run();
}

function onDocDown(e: MouseEvent): void {
  if (!(e.target as HTMLElement | null)?.closest('.ra-menu')) open.value = false;
}
function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false;
}

// 只在展开时挂监听，避免几十行各挂一份
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
  } else {
    document.removeEventListener('mousedown', onDocDown);
    document.removeEventListener('keydown', onEsc);
  }
});
onMounted(() => window.addEventListener('resize', () => (open.value = false)));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('keydown', onEsc);
});
</script>

<template>
  <div class="row-actions">
    <button v-if="primary" type="button" class="btn btn-ghost mini" :disabled="primary.disabled" @click="primary.run()">
      {{ primary.label }}
    </button>
    <div v-if="items && items.length" class="ra-menu">
      <button
        ref="moreBtn"
        type="button"
        class="btn btn-ghost mini"
        :class="{ 'is-open': open }"
        @click.stop="open ? (open = false) : openMenu()"
      >
        更多<span class="caret" aria-hidden="true">▾</span>
      </button>
      <div v-if="open" class="ra-panel" :style="panelStyle" @mousedown.stop>
        <button
          v-for="(a, i) in items"
          :key="i"
          type="button"
          :class="{ danger: a.danger }"
          :disabled="a.disabled"
          @click="run(a)"
        >
          {{ a.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  white-space: nowrap;
}
.ra-menu {
  position: relative;
}
.ra-menu .caret {
  margin-left: 3px;
  font-size: 0.7em;
  opacity: 0.65;
}
.ra-panel {
  position: fixed;
  z-index: 80;
  min-width: 132px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--paper-card, #fff);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}
.ra-panel button {
  width: 100%;
  padding: 7px 10px;
  text-align: left;
  font: inherit;
  font-size: 0.84rem;
  white-space: nowrap;
  color: var(--ink-mid);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.ra-panel button:hover {
  color: var(--cinnabar);
  background: rgba(194, 58, 48, 0.06);
}
.ra-panel button.danger {
  color: var(--cinnabar);
}
.ra-panel button.danger:hover {
  background: rgba(194, 58, 48, 0.1);
}
.ra-panel button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
