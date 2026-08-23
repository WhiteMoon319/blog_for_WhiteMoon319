<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { diffLines, diffWords } from 'diff';
import { api } from '../api';
import type { PostVersion } from '../types';

const props = defineProps<{
  postId: number;
  currentMarkdown: () => string;
}>();

const emit = defineEmits<{
  close: [];
  notify: [msg: string, err?: boolean];
  restored: [];
}>();

interface DiffSeg {
  kind: 'add' | 'del' | 'ctx';
  paired: boolean;
  line: string;
  words: Array<{ kind: 'add' | 'del' | 'keep'; text: string }>;
}

const versions = ref<PostVersion[]>([]);
const versionsBusy = ref(false);
const selVersion = ref<number | null>(null);
const cmpTarget = ref<number | 'current'>('current');
const diffSegs = ref<DiffSeg[] | null>(null);
const diffMeta = ref('');

function computeDiff(a: string, b: string): DiffSeg[] {
  const parts = diffLines(a, b);
  const segs: DiffSeg[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const splitLines = (v: string) => {
    const lines = v.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const flushPair = () => {
    while (dels.length > 0 && adds.length > 0) {
      const d = dels.shift()!;
      const ad = adds.shift()!;
      const words = diffWords(d, ad).map((w) => ({
        kind: w.removed ? ('del' as const) : w.added ? ('add' as const) : ('keep' as const),
        text: w.value,
      }));
      segs.push({ kind: 'del', line: d, words, paired: true });
      segs.push({ kind: 'add', line: ad, words, paired: true });
    }
    for (const d of dels) segs.push({ kind: 'del', line: d, words: [], paired: false });
    for (const ad of adds) segs.push({ kind: 'add', line: ad, words: [], paired: false });
    dels = [];
    adds = [];
  };
  for (const p of parts) {
    if (p.removed) dels.push(...splitLines(p.value));
    else if (p.added) adds.push(...splitLines(p.value));
    else {
      flushPair();
      for (const l of splitLines(p.value)) segs.push({ kind: 'ctx', line: l, words: [], paired: false });
    }
  }
  flushPair();
  return segs;
}

function metaOf(v: PostVersion, label: string): string {
  const bits = [`v${v.version} · ${label}`, v.status === 'published' ? '已刊' : '草稿'];
  if (v.collection_id !== null) bits.push(`文集#${v.collection_id}`);
  if (v.slug) bits.push(v.slug);
  if (v.summary) bits.push('有摘要');
  if (v.cover_url) bits.push('有封面');
  return bits.join('　');
}

async function refreshDiff() {
  if (selVersion.value === null) {
    diffSegs.value = null;
    diffMeta.value = '';
    return;
  }
  const base = versions.value.find((v) => v.version === selVersion.value);
  if (!base) return;
  if (cmpTarget.value === 'current') {
    diffSegs.value = computeDiff(base.content_md, props.currentMarkdown());
    diffMeta.value = metaOf(base, '基线') + '\n→ 当前工作区（未保存）';
  } else {
    const other = versions.value.find((v) => v.version === cmpTarget.value);
    if (!other) return;
    diffSegs.value = computeDiff(base.content_md, other.content_md);
    diffMeta.value = metaOf(base, '基线') + '\n→ ' + metaOf(other, '对比');
  }
}

async function load() {
  versionsBusy.value = true;
  try {
    const res = await api.postVersions(props.postId);
    versions.value = res.versions;
    const first = res.versions[0];
    selVersion.value = first ? first.version : null;
    cmpTarget.value = 'current';
    await refreshDiff();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    versionsBusy.value = false;
  }
}

onMounted(() => {
  void load();
});

async function restoreVersion(v: PostVersion) {
  if (!confirm(`确认回滚到 v${v.version}（${v.created_at.slice(0, 10)}）？当前内容将被覆盖，并生成一条新版本记录。`)) return;
  versionsBusy.value = true;
  try {
    await api.restorePostVersion(props.postId, v.version);
    emit('notify', `已回滚至 v${v.version}`);
    emit('restored');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    versionsBusy.value = false;
  }
}
</script>

<template>
  <div class="media-mask" @click.self="emit('close')">
    <div class="media-modal" style="width:min(1080px, 96vw);">
      <div class="media-modal-head">
        <span>版本史（每次保存自动留档，可对比与回滚）</span>
        <button class="btn btn-ghost mini" @click="emit('close')">关</button>
      </div>
      <div class="versions-body">
        <aside class="versions-list">
          <div v-if="versionsBusy" class="empty">载入中…</div>
          <template v-else>
            <div
              v-for="v in versions"
              :key="v.version"
              class="ver-item"
              :class="{ on: selVersion === v.version }"
              @click="selVersion = v.version; refreshDiff()"
            >
              <div class="ver-head">
                <span class="ver-no">v{{ v.version }}</span>
                <span class="ver-date">{{ v.created_at.slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <div class="ver-msg">{{ v.message || '自动保存' }}</div>
              <div class="ver-title">{{ v.title }}</div>
              <div class="ver-foot">
                <span class="tag" :class="v.status === 'published' ? 'tag-published' : 'tag-draft'">
                  {{ v.status === 'published' ? '已刊' : '草稿' }}
                </span>
                <button class="btn btn-danger mini" :disabled="versionsBusy" @click.stop="restoreVersion(v)">
                  回滚到此
                </button>
              </div>
            </div>
            <div v-if="versions.length === 0" class="empty">尚无版本。</div>
          </template>
        </aside>
        <section class="versions-diff">
          <div class="diff-toolbar">
            <select v-model="selVersion" class="select" @change="refreshDiff" style="width:auto;">
              <option v-for="v in versions" :key="v.version" :value="v.version">基线 v{{ v.version }}（{{ v.created_at.slice(0, 10) }}）</option>
            </select>
            <span class="diff-arrow">→</span>
            <select v-model="cmpTarget" class="select" @change="refreshDiff" style="width:auto;">
              <option value="current">当前工作区（未保存）</option>
              <option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }}（{{ v.created_at.slice(0, 10) }}）</option>
            </select>
            <span class="diff-legend">
              <span class="lg lg-add">＋新增</span>
              <span class="lg lg-del">－删除</span>
            </span>
          </div>
          <pre class="diff-view" v-if="diffSegs">
<template v-for="(seg, i) in diffSegs" :key="i"><span class="diff-line" :class="[seg.kind, seg.paired ? 'pair' : 'full']"><span class="diff-mark">{{ seg.kind === 'add' ? '+' : seg.kind === 'del' ? '-' : ' ' }}</span><span v-if="seg.words.length" class="diff-words"><template v-for="(w, j) in seg.words" :key="j"><span :class="'dw ' + w.kind">{{ w.text }}</span></template></span><template v-else>{{ seg.line }}</template></span>
</template>
</pre>
          <div v-else class="empty">选择基线后显示差异。</div>
          <div class="diff-meta" v-if="diffMeta">{{ diffMeta }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 16, 0.5);
  display: grid;
  place-items: center;
  z-index: 60;
}
.media-modal {
  width: min(760px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--paper-card);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  overflow: hidden;
}
.media-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
  font-family: var(--font-serif);
  color: var(--ink-deep);
}
.versions-body {
  display: flex;
  min-height: 380px;
  max-height: 70vh;
}
.versions-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--hairline);
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ver-item {
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--paper-card);
}
.ver-item.on {
  border-color: var(--cinnabar);
  background: color-mix(in srgb, var(--cinnabar) 6%, var(--paper-card));
}
.ver-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.ver-no {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--cinnabar);
}
.ver-date {
  font-size: 0.72rem;
  color: var(--ink-light);
}
.ver-msg {
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-title {
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--ink-deep);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-foot {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.versions-diff {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline);
}
.diff-arrow {
  color: var(--ink-light);
}
.diff-legend {
  margin-left: auto;
  display: flex;
  gap: 10px;
  font-size: 0.75rem;
}
.lg {
  padding: 2px 8px;
  border-radius: 4px;
}
.lg-add {
  background: rgba(45, 106, 79, 0.14);
  color: #2d6a4f;
}
.lg-del {
  background: rgba(194, 58, 48, 0.14);
  color: #c23a30;
}
.diff-view {
  flex: 1;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
.diff-line {
  display: block;
}
.diff-line.del.full {
  background: rgba(194, 58, 48, 0.12);
  color: #9c2f26;
}
.diff-line.add.full {
  background: rgba(45, 106, 79, 0.12);
  color: #1f5c40;
}
.diff-line.pair {
  background: transparent;
}
.diff-line.ctx {
  color: var(--ink-soft);
}
.diff-mark {
  display: inline-block;
  width: 1.2em;
  user-select: none;
}
.dw.add {
  background: rgba(45, 106, 79, 0.3);
}
.dw.del {
  background: rgba(194, 58, 48, 0.3);
}
.diff-meta {
  padding: 10px 16px;
  border-top: 1px solid var(--hairline);
  font-size: 0.75rem;
  color: var(--ink-light);
  white-space: pre-wrap;
}
</style>