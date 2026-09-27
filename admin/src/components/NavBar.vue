<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
// 后台与写作区共用的顶栏导航。
// 目的是不再把十几个入口平铺成一行（中等宽度就会折行），而是按用途收成若干下拉组；
// 分组名与子项由调用方给，右侧动作走插槽。
import { onBeforeUnmount, onMounted, ref } from 'vue';

export interface NavItem {
  to: string;
  text: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

defineProps<{
  /** 品牌印章里的字 */
  seal: string;
  /** 品牌名 */
  title: string;
  /** 品牌点击跳转 */
  brandHref: string;
  /** 直接平铺的入口（一般只放「工作台」这类首页入口） */
  flat?: NavItem[];
  /** 分组下拉 */
  groups?: NavGroup[];
}>();

const openGroup = ref<string | null>(null);

function toggleGroup(label: string): void {
  openGroup.value = openGroup.value === label ? null : label;
}

function onDocDown(e: MouseEvent): void {
  if (!openGroup.value) return;
  if (!(e.target as HTMLElement | null)?.closest('.admin-nav')) openGroup.value = null;
}

function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') openGroup.value = null;
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('keydown', onEsc);
});
</script>

<template>
  <nav class="admin-nav">
    <a class="admin-brand" :href="brandHref">
      <span class="seal">{{ seal }}</span>
      <span class="brand-text">{{ title }}</span>
    </a>

    <div class="admin-links">
      <router-link v-for="item in flat ?? []" :key="item.to" :to="item.to" @click="openGroup = null">
        {{ item.text }}
      </router-link>

      <div v-for="g in groups ?? []" :key="g.label" class="nav-group">
        <button
          type="button"
          class="nav-group-btn"
          :class="{ 'is-open': openGroup === g.label }"
          @click.stop="toggleGroup(g.label)"
        >
          {{ g.label }}<span class="caret" aria-hidden="true">▾</span>
        </button>
        <div v-if="openGroup === g.label" class="nav-panel" @mousedown.stop>
          <router-link v-for="item in g.items" :key="item.to" :to="item.to" @click="openGroup = null">
            {{ item.text }}
          </router-link>
        </div>
      </div>
    </div>

    <span class="spacer"></span>

    <slot name="actions" />
  </nav>
</template>

<style scoped>
.nav-group {
  position: relative;
}
.nav-group-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  font: inherit;
  font-size: 0.9rem;
  white-space: nowrap;
  color: var(--ink-mid);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
}
.nav-group-btn:hover,
.nav-group-btn.is-open {
  color: var(--cinnabar);
  border-color: var(--cinnabar-line);
  background: rgba(194, 58, 48, 0.06);
}
.nav-group-btn .caret {
  font-size: 0.7em;
  opacity: 0.65;
}
.nav-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 60;
  min-width: 132px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--paper-card, #fff);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.nav-panel a {
  padding: 7px 10px;
  font-size: 0.88rem;
  white-space: nowrap;
  color: var(--ink-mid);
  text-decoration: none;
  border-radius: 4px;
}
.nav-panel a:hover,
.nav-panel a.router-link-active {
  color: var(--cinnabar);
  background: rgba(194, 58, 48, 0.06);
}
</style>
