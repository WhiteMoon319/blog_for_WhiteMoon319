<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';

const props = defineProps<{
  mode: 'wysiwyg' | 'source';
  editor?: Editor;
  uploading: boolean;
  showBorderMenu: boolean;
  showBlockDrawer: boolean;
}>();

const emit = defineEmits<{
  'switch-mode': [mode: 'wysiwyg' | 'source'];
  snippet: [before: string, after?: string, placeholder?: string];
  'insert-block': [block: string];
  'insert-image': [];
  'open-picker': [];
  'set-link': [];
  'toggle-borders': [];
  'toggle-blocks': [];
}>();

// 源码模式的对齐片段：编辑器写入的内联 style 与前台渲染一致
const SNIPPET_ALIGN_CENTER = '<p style="text-align:center">居中文字</p>';
const SNIPPET_ALIGN_RIGHT = '<p style="text-align:right">右对齐文字</p>';
const SNIPPET_TABLE = '| 列一 | 列二 |\n| --- | --- |\n| 单元格 | 单元格 |';
const SNIPPET_CODE = '```\n代码…\n```';
const SNIPPET_MATH = '$$\nE = mc^2\n$$';
const SNIPPET_MERMAID = '```mermaid\ngraph TD\n  A[起点] --> B{判断}\n  B -->|是| C[结果]\n  B -->|否| D[另一路径]\n```';
const SNIPPET_MARKMAP = '```markmap\n# 脑图标题\n## 分支一\n### 子分支\n## 分支二\n```';

// ---- 工具条：两个下拉菜单（插入 / 格式），把原先铺满两行的按钮收起来 ----
const openMenu = ref<null | 'insert' | 'format'>(null);
function toggleMenu(name: 'insert' | 'format'): void {
  openMenu.value = openMenu.value === name ? null : name;
}

function menuAction(fn: () => void): void {
  openMenu.value = null;
  fn();
}

function onToolbarDocDown(e: MouseEvent): void {
  if (!openMenu.value) return;
  if (!(e.target as HTMLElement | null)?.closest('.editor-toolbar')) openMenu.value = null;
}
function onToolbarEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') openMenu.value = null;
}

onMounted(() => {
  document.addEventListener('mousedown', onToolbarDocDown);
  document.addEventListener('keydown', onToolbarEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onToolbarDocDown);
  document.removeEventListener('keydown', onToolbarEsc);
});

/** 源码模式下这几个按钮没有编辑器命令，退化为插入 Markdown 片段 */
function ci(action: 'bold' | 'italic' | 'strike' | 'h2' | 'h3'): void {
  const ed = props.editor;
  if (props.mode === 'wysiwyg') {
    if (!ed) return;
    if (action === 'bold') ed.chain().focus().toggleBold().run();
    else if (action === 'italic') ed.chain().focus().toggleItalic().run();
    else if (action === 'strike') ed.chain().focus().toggleStrike().run();
    else if (action === 'h2') ed.chain().focus().toggleHeading({ level: 2 }).run();
    else ed.chain().focus().toggleHeading({ level: 3 }).run();
    return;
  }
  if (action === 'bold') emit('snippet', '**', '**', '文本');
  else if (action === 'italic') emit('snippet', '*', '*', '文本');
  else if (action === 'strike') emit('snippet', '~~', '~~', '文本');
  else if (action === 'h2') emit('snippet', '## ', '', '小标题');
  else emit('snippet', '### ', '', '小标题');
}

function editorChain(fn: (ed: Editor) => void): void {
  const ed = props.editor;
  if (!ed) return;
  fn(ed);
}
</script>

<template>
  <div class="editor-toolbar">
    <div class="mode-seg">
      <button type="button" class="mode-toggle" :class="{ active: mode === 'wysiwyg' }" @click="emit('switch-mode', 'wysiwyg')">可视化</button>
      <button type="button" class="mode-toggle" :class="{ active: mode === 'source' }" @click="emit('switch-mode', 'source')">源码</button>
    </div>

    <span class="sep"></span>

    <button type="button" title="粗体" :class="{ 'is-active': mode === 'wysiwyg' && editor?.isActive('bold') }" @click="ci('bold')"><b>B</b></button>
    <button type="button" title="斜体" :class="{ 'is-active': mode === 'wysiwyg' && editor?.isActive('italic') }" @click="ci('italic')"><i>I</i></button>
    <button type="button" title="删除线" :class="{ 'is-active': mode === 'wysiwyg' && editor?.isActive('strike') }" @click="ci('strike')"><s>S</s></button>

    <span class="sep"></span>

    <button type="button" title="二级标题" :class="{ 'is-active': mode === 'wysiwyg' && editor?.isActive('heading', { level: 2 }) }" @click="ci('h2')">H2</button>
    <button type="button" title="三级标题" :class="{ 'is-active': mode === 'wysiwyg' && editor?.isActive('heading', { level: 3 }) }" @click="ci('h3')">H3</button>

    <span class="sep"></span>

    <div class="tb-menu">
      <button type="button" class="tb-menu-btn" :class="{ 'is-active': openMenu === 'insert' }" @click.stop="toggleMenu('insert')">插入 <span class="caret">▾</span></button>
      <div v-if="openMenu === 'insert'" class="tb-panel" @mousedown.stop>
        <template v-if="mode === 'wysiwyg'">
          <button type="button" :disabled="uploading" @click="menuAction(() => emit('insert-image'))">{{ uploading ? '图片（上传中…）' : '图片' }}</button>
          <button type="button" @click="menuAction(() => emit('open-picker'))">从媒体库选</button>
          <button type="button" @click="menuAction(() => emit('set-link'))">链接</button>
          <button type="button" @click="menuAction(() => editorChain((ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()))">表格</button>
          <button type="button" @click="menuAction(() => editorChain((ed) => ed.chain().focus().setHorizontalRule().run()))">分割线</button>
          <button type="button" @click="menuAction(() => editorChain((ed) => ed.chain().focus().toggleCodeBlock().run()))">代码块</button>
        </template>
        <template v-else>
          <button type="button" @click="menuAction(() => emit('snippet', '![', '](https://)', '描述'))">图片</button>
          <button type="button" @click="menuAction(() => emit('snippet', '[', '](https://)', '链接文字'))">链接</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_TABLE))">表格</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_CODE))">代码块</button>
          <span class="tb-panel-sep"></span>
          <button type="button" @click="menuAction(() => emit('snippet', '$', '$', 'E = mc^2'))">行内公式</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_MATH))">块级公式</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_MERMAID))">Mermaid 图表</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_MARKMAP))">Markmap 脑图</button>
        </template>
      </div>
    </div>

    <div class="tb-menu">
      <button type="button" class="tb-menu-btn" :class="{ 'is-active': openMenu === 'format' }" @click.stop="toggleMenu('format')">格式 <span class="caret">▾</span></button>
      <div v-if="openMenu === 'format'" class="tb-panel" @mousedown.stop>
        <template v-if="mode === 'wysiwyg'">
          <button type="button" :class="{ 'is-active': editor?.isActive('bulletList') }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().toggleBulletList().run()))">无序列表</button>
          <button type="button" :class="{ 'is-active': editor?.isActive('orderedList') }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().toggleOrderedList().run()))">有序列表</button>
          <button type="button" :class="{ 'is-active': editor?.isActive('blockquote') }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().toggleBlockquote().run()))">引文</button>
          <span class="tb-panel-sep"></span>
          <button type="button" :class="{ 'is-active': editor?.isActive({ textAlign: 'left' }) }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().setTextAlign('left').run()))">左对齐</button>
          <button type="button" :class="{ 'is-active': editor?.isActive({ textAlign: 'center' }) }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().setTextAlign('center').run()))">居中</button>
          <button type="button" :class="{ 'is-active': editor?.isActive({ textAlign: 'right' }) }" @click="menuAction(() => editorChain((ed) => ed.chain().focus().setTextAlign('right').run()))">右对齐</button>
        </template>
        <template v-else>
          <button type="button" @click="menuAction(() => emit('snippet', '- 条目'))">无序列表</button>
          <button type="button" @click="menuAction(() => emit('snippet', '1. 条目'))">有序列表</button>
          <button type="button" @click="menuAction(() => emit('insert-block', '> 引用文字'))">引文</button>
          <span class="tb-panel-sep"></span>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_ALIGN_CENTER))">居中</button>
          <button type="button" @click="menuAction(() => emit('insert-block', SNIPPET_ALIGN_RIGHT))">右对齐</button>
        </template>
      </div>
    </div>

    <button
      v-if="mode === 'wysiwyg' && editor?.isActive('table')"
      type="button"
      class="blk-toggle"
      :class="{ 'is-active': showBorderMenu }"
      title="表格框线（可逐边开关）"
      @click="emit('toggle-borders')"
    >框线</button>

    <span class="tb-spacer"></span>

    <button
      type="button"
      class="blk-toggle"
      :class="{ 'is-active': showBlockDrawer }"
      :disabled="mode === 'source'"
      title="公众号式排版素材（仅可视化模式）"
      @click="emit('toggle-blocks')"
    >✦ 排版</button>
    <template v-if="mode === 'wysiwyg'">
      <button type="button" title="撤销" @click="editorChain((ed) => ed.chain().focus().undo().run())">↩</button>
      <button type="button" title="重做" @click="editorChain((ed) => ed.chain().focus().redo().run())">↪</button>
    </template>
  </div>
</template>

<style scoped>
/* 工具条自身的样式：分段控件、下拉菜单、右侧留白。
   这些规则原先写在 PostEditorView 里，随 markup 一起搬过来——
   留在父组件的话 scoped 作用域不匹配，下拉面板会失去绝对定位、退化成横排。 */
.editor-toolbar {
  align-items: center;
}

.mode-toggle {
  padding: 4px 12px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-light);
  cursor: pointer;
  font: inherit;
}

.mode-toggle.active {
  background: var(--cinnabar);
  color: #fff;
  border-color: var(--cinnabar);
}

.mode-seg {
  display: inline-flex;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  overflow: hidden;
}
.mode-seg .mode-toggle {
  border: 0;
  border-radius: 0;
  padding: 4px 12px;
}
.mode-seg .mode-toggle + .mode-toggle {
  border-left: 1px solid var(--hairline);
}
.tb-spacer {
  flex: 1 1 auto;
}
.tb-menu {
  position: relative;
}
.tb-menu-btn .caret {
  margin-left: 3px;
  font-size: 0.7em;
  opacity: 0.65;
}
.tb-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 152px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--paper-card, #fff);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.tb-panel button {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  text-align: left;
  font-size: 0.85rem;
  color: var(--ink-mid);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.tb-panel button:hover {
  color: var(--cinnabar);
  background: rgba(194, 58, 48, 0.06);
}
.tb-panel button.is-active {
  color: var(--cinnabar);
}
.tb-panel button:disabled {
  opacity: 0.5;
  cursor: default;
}
.tb-panel-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--hairline);
}

@media (max-width: 900px) {
  .tb-spacer {
    display: none;
  }
}
</style>
