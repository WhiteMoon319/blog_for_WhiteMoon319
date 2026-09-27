<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed } from 'vue';
import TagChips from './TagChips.vue';
import type { AuthorOption, Collection } from '../types';

/** 与父组件共享同一个 reactive 对象：本组件直接改字段，父组件读到的是同一份 */
export type PostMetaForm = {
  title: string;
  slug: string;
  collection_id: number | null;
  summary: string;
  cover_url: string;
  meta_keywords: string;
  is_pinned: number;
  scheduled_enabled: boolean;
  scheduled_local: string;
  status: 'draft' | 'published';
  version_message: string;
  tags: string[];
  inherited_tags: string[];
  author_ids: number[];
  layout: string;
};

const props = defineProps<{
  form: PostMetaForm;
  collections: Collection[];
  authorOptions: AuthorOption[];
  suggestions: string[];
  promptTemplates: Array<{ id: string; name: string }>;
  selectedPromptId: string;
  generatingSummary: boolean;
  uploading: boolean;
  canWrite: (id: number | null) => boolean;
}>();

const emit = defineEmits<{
  notify: [msg: string, err?: boolean];
  'generate-summary': [];
  'pick-cover': [];
  'update:selectedPromptId': [value: string];
}>();

/** 显示名：优先笔名，兜底用户名；名单尚未载入时退回「#id」 */
function authorLabel(id: number): string {
  const a = props.authorOptions.find((o) => o.id === id);
  return a ? a.display_name?.trim() || a.username : `#${id}`;
}

/** 可添加的作者：排除已在署名里的 */
const addableAuthors = computed(() => props.authorOptions.filter((a) => !props.form.author_ids.includes(a.id)));

function addAuthor(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const id = Number(select.value);
  select.value = '';
  if (!Number.isInteger(id) || id <= 0 || props.form.author_ids.includes(id)) return;
  if (props.form.author_ids.length >= 10) {
    emit('notify', '署名作者最多 10 位', true);
    return;
  }
  props.form.author_ids.push(id);
}

function removeAuthor(index: number): void {
  props.form.author_ids.splice(index, 1);
}

/** 上下移动：顺序即前台展示顺序，第一位是主作者 */
function moveAuthor(index: number, delta: number): void {
  const next = index + delta;
  if (next < 0 || next >= props.form.author_ids.length) return;
  const [id] = props.form.author_ids.splice(index, 1);
  props.form.author_ids.splice(next, 0, id);
}
</script>

<template>
  <div class="form-row">
    <div class="field">
      <label>篇名 *</label>
      <input v-model="form.title" class="input" placeholder="如：把 Astro 架到 Cloudflare 上" />
    </div>
    <div class="field">
      <label>URL 标识（可留空自动生成）</label>
      <input v-model="form.slug" class="input" placeholder="astro-on-cloudflare" />
    </div>
  </div>

  <div class="form-row">
    <div class="field">
      <label>所属文集</label>
      <select v-model="form.collection_id" class="select">
        <option :value="null">未分类</option>
        <option v-for="c in collections" :key="c.id" :value="c.id" :disabled="!canWrite(c.id)">
          {{ c.title }}{{ canWrite(c.id) ? '' : '（私有·需作者同意）' }}
        </option>
      </select>
      <div v-if="!canWrite(form.collection_id)" class="hint mt-6 text-danger">
        该文集为私有，需文集作者同意才能投稿；可在「我的文集」页发起协作申请。
      </div>
    </div>
    <div class="field">
      <label>状态</label>
      <select v-model="form.status" class="select">
        <option value="draft">草稿（暂不示人）</option>
        <option value="published">刊发（立即示人）</option>
      </select>
    </div>
  </div>

  <div class="field">
    <label>全文样式</label>
    <select v-model="form.layout" class="select">
      <option value="">跟随主题（默认）</option>
      <option value="wechat">公众号风（16px / 行高 1.75 / 两端缩进）</option>
      <option value="magazine">杂志风（17px / 行高 1.8 / 疏朗）</option>
      <option value="warm">温润风（16px / 行高 1.9 / 首行缩进）</option>
    </select>
    <div class="hint mt-6 text-muted">只改正文排版节奏，不改块样式；块内观感仍由「✦ 排版」决定。</div>
  </div>

  <div class="field">
    <label>署名作者（顺序即展示顺序，第一位为主作者）</label>
    <div class="author-picker">
      <span v-for="(id, idx) in form.author_ids" :key="id" class="author-chip-item">
        <span v-if="idx === 0" class="author-primary">主</span>
        {{ authorLabel(id) }}
        <button type="button" class="chip-op" title="上移" :disabled="idx === 0" @click="moveAuthor(idx, -1)">↑</button>
        <button
          type="button"
          class="chip-op"
          title="下移"
          :disabled="idx === form.author_ids.length - 1"
          @click="moveAuthor(idx, 1)"
        >↓</button>
        <button type="button" class="chip-op" title="移除" @click="removeAuthor(idx)">×</button>
      </span>
      <select class="select select-xs" @change="addAuthor">
        <option value="">添加作者…</option>
        <option v-for="a in addableAuthors" :key="a.id" :value="a.id">
          {{ a.display_name?.trim() || a.username }}（{{ a.post_count }} 篇）
        </option>
      </select>
    </div>
    <div class="hint mt-6">
      留空则文章无署名；前台按此顺序展示并链接到各作者页。
    </div>
  </div>

  <div class="field">
    <label>标签（自有，叠加在文集标签之上）</label>
    <TagChips v-model="form.tags" :suggestions="suggestions" placeholder="回车添加标签" />
    <div v-if="form.inherited_tags.length" class="hint tag-row mt-8">
      继承自文集：
      <span v-for="t in form.inherited_tags" :key="t" class="tag-chip-item is-readonly">{{ t }}</span>
    </div>
  </div>

  <div class="field">
    <label>摘要</label>
    <div class="row-top">
      <textarea v-model="form.summary" class="textarea grow" placeholder="列表卡上的一行小字" />
      <div class="col-stack">
        <select
          class="select select-xs"
          :value="selectedPromptId"
          @change="emit('update:selectedPromptId', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="t in promptTemplates" :key="t.id" :value="t.id">{{ t.name }}（{{ t.id }}）</option>
        </select>
        <button type="button" class="btn btn-ghost nowrap mt-2" :disabled="generatingSummary" @click="emit('generate-summary')">
          {{ generatingSummary ? '生成中…' : 'AI 生成' }}
        </button>
      </div>
    </div>
  </div>

  <div class="field">
    <label>SEO 关键词（meta keywords，逗号分隔，最多 200 字）</label>
    <input v-model="form.meta_keywords" class="input" maxlength="200" placeholder="文章、随笔、书房" />
  </div>

  <label class="checkbox-row">
    <input
      type="checkbox"
      :checked="form.is_pinned === 1"
      @change="form.is_pinned = ($event.target as HTMLInputElement).checked ? 1 : 0"
    />
    置顶（首页「置于案头」区展示，列表内仍照常可见）
  </label>

  <div class="field">
    <label>定时发布（到点自动刊发；仅草稿可设）</label>
    <div class="row-wrap">
      <label class="checkbox-row">
        <input
          type="checkbox"
          v-model="form.scheduled_enabled"
          :disabled="form.status === 'published'"
        />
        启用
      </label>
      <input
        v-if="form.scheduled_enabled"
        v-model="form.scheduled_local"
        type="datetime-local"
        step="60"
        class="input w-auto"
      />
    </div>
    <div class="hint mt-8">
      按本机时区展示，提交后转为 UTC 存储；cron 每 5 分钟轮询，到点可能略有延迟，不承诺秒级准点。
      手动刊发会清空定时。
    </div>
  </div>

  <div class="field">
    <label>封面</label>
    <div class="row-wrap">
      <button class="btn btn-ghost" type="button" @click="emit('pick-cover')" :disabled="uploading">上传封面</button>
      <img
        v-if="form.cover_url"
        :src="form.cover_url"
        alt="封面"
        class="cover-thumb"
      />
      <button v-if="form.cover_url" class="btn btn-danger mini" type="button" @click="form.cover_url = ''">
        去封面
      </button>
    </div>
  </div>
</template>
