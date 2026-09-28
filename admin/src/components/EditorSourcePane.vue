<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown as markdownLang, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { api } from '../api';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const cmHost = ref<HTMLDivElement | null>(null);
const previewHost = ref<HTMLDivElement | null>(null);
const previewHtml = ref('');
const previewing = ref(false);
let cmView: EditorView | null = null;
const cmLang = new Compartment();
// 当前文档快照：预览请求用它比对，避免依赖父组件回传 prop 的时序
let lastDoc = props.modelValue;

function buildCmState(md: string): EditorState {
  return EditorState.create({
    doc: md,
    extensions: [
      cmLang.of([markdownLang({ base: markdownLanguage })]),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          lastDoc = update.state.doc.toString();
          emit('update:modelValue', lastDoc);
          schedulePreview();
        }
      }),
    ],
  });
}

let previewTimer: number | null = null;
function schedulePreview() {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void runPreview(), 400);
}

async function runPreview() {
  const md = lastDoc;
  previewing.value = true;
  try {
    const { html } = await api.render(md);
    if (md === lastDoc) {
      previewHtml.value = html; // 丢弃过期响应
      void renderDiagrams();
    }
  } catch {
    // 预览失败保留上一次成功结果
  } finally {
    previewing.value = false;
  }
}

// 与公开站点 ArticleEnhancer 同链路：对预览 HTML 中的 mermaid/markmap 容器做客户端渲染
async function renderDiagrams() {
  const host = previewHost.value;
  if (!host) return;

  // 动态注入 KaTeX 和 hljs 样式（仅首次需要）
  if (!document.querySelector('link[href="/_assets/katex.min.css"]')) {
    const katexLink = document.createElement('link');
    katexLink.rel = 'stylesheet';
    katexLink.href = '/_assets/katex.min.css';
    document.head.appendChild(katexLink);
  }
  if (!document.querySelector('link[href="/_assets/github-dark.css"]')) {
    const hljsLink = document.createElement('link');
    hljsLink.rel = 'stylesheet';
    hljsLink.href = '/_assets/github-dark.css';
    document.head.appendChild(hljsLink);
  }

  const mermaidEls = Array.from(host.querySelectorAll<HTMLElement>('.diagram.mermaid'));
  if (mermaidEls.length > 0) {
    // 动态 import mermaid（约 2MB，按需加载）
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
    await Promise.all(
      mermaidEls.map(async (el, i) => {
        try {
          const { svg } = await mermaid.render(`pm-${i}-${Date.now()}`, el.textContent ?? '');
          el.innerHTML = svg;
          el.classList.add('diagram-rendered');
        } catch {
          el.classList.add('diagram-error');
        }
      }),
    );
  }

  const markmapEls = Array.from(host.querySelectorAll<HTMLElement>('.diagram.markmap'));
  if (markmapEls.length > 0) {
    // 动态 import markmap（约 500KB，按需加载）
    const [{ Transformer }, { Markmap }] = await Promise.all([import('markmap-lib'), import('markmap-view')]);
    const transformer = new Transformer();
    markmapEls.forEach((el) => {
      try {
        const { root } = transformer.transform(el.textContent ?? '');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'markmap-svg');
        el.appendChild(svg);
        Markmap.create(svg, { autoFit: true, initialExpandLevel: 2 }, root);
        el.classList.add('diagram-rendered');
      } catch {
        el.classList.add('diagram-error');
      }
    });
  }
}

onMounted(() => {
  if (!cmHost.value) return;
  cmView = new EditorView({ state: buildCmState(props.modelValue), parent: cmHost.value });
  cmView.focus();
  void runPreview();
});

onBeforeUnmount(() => {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  cmView?.destroy();
  cmView = null;
});

/** 在光标处插入片段（工具条「插入 / 格式」菜单调用） */
function insertSnippet(before: string, after = '', placeholder = ''): void {
  const view = cmView;
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const insert = `${before}${placeholder}${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length, head: from + before.length + placeholder.length },
  });
  view.focus();
}

/** 以整块替换文档（工具条插入模板片段用） */
function insertBlock(block: string): void {
  const view = cmView;
  if (!view) return;
  const text = view.state.doc.toString();
  const insert = `\n\n${block}\n\n`;
  view.dispatch({
    changes: { from: 0, to: text.length, insert: text.trim() ? text.replace(/\n+$/, '') + insert : insert },
  });
  view.focus();
}

defineExpose({ insertSnippet, insertBlock });
</script>

<template>
  <div class="source-area">
    <div class="source-blk-hint">
      排版块语法：<code>:::name{type=variant}</code> … <code>:::</code>（块名如 callout / quote / steps /
      divider）。记不住就在可视化模式点「✦ 排版」插入。
    </div>
    <div ref="cmHost" class="cm-host" />
    <div ref="previewHost" class="source-preview" :class="{ refreshing: previewing }">
      <p v-if="previewing" class="preview-hint">渲染中…</p>
      <div v-html="previewHtml" />
    </div>
  </div>
</template>

<style scoped>
.source-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 420px;
}

.source-blk-hint {
  grid-column: 1 / -1;
  font-size: 0.82rem;
  color: var(--muted);
  background: var(--paper-2, #f6f1e7);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 6px 10px;
}

.source-blk-hint code {
  font-size: 0.8rem;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  padding: 0 4px;
}

.cm-host {
  overflow: auto;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: #fbfaf8;
  font-size: 0.9rem;
  line-height: 1.7;
}

.cm-host .cm-editor {
  min-height: 420px;
  outline: none;
}

.source-preview {
  overflow: auto;
  padding: 16px 20px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--paper-card);
}

.source-preview h1,
.source-preview h2,
.source-preview h3 {
  line-height: 1.4;
}

.source-preview pre {
  overflow-x: auto;
  padding: 14px 16px;
  border-radius: 6px;
  background: var(--ink-black);
  color: #e8e4dc;
}

.source-preview code {
  font-family: Consolas, 'SF Mono', Menlo, monospace;
  font-size: 0.85rem;
}

.source-preview table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.source-preview th,
.source-preview td {
  padding: 0.4em 0.8em;
  border: 1px solid var(--hairline);
}

.source-preview .katex-display {
  margin: 1.6em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.source-preview .katex-error {
  color: var(--cinnabar);
  font-style: italic;
}

.source-preview .diagram {
  margin: 1.6em auto;
  padding: 16px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--paper-card);
  overflow-x: auto;
  text-align: center;
}

.source-preview .diagram svg {
  max-width: 100%;
  height: auto;
}

.source-preview .diagram.diagram-error {
  color: var(--cinnabar);
  font-style: italic;
  text-align: left;
  white-space: pre-wrap;
}

.preview-hint {
  color: var(--ink-light);
  font-size: 0.8rem;
}

.source-preview.refreshing {
  opacity: 0.6;
  transition: opacity 0.15s ease;
}

@media (max-width: 900px) {
  .source-area {
    grid-template-columns: 1fr;
  }
}
</style>
