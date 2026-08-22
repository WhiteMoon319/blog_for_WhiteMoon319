<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { Collection, Tag } from '../types';
import TagChips from '../components/TagChips.vue';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const collections = ref<Collection[]>([]);
const loaded = ref(false);
const editing = ref<Collection | null>(null);
const creating = ref(false);
const suggestions = ref<string[]>([]);

const form = reactive({ title: '', slug: '', summary: '', theme_color: '#c23a30', sort_order: 0, post_order: 'desc' as 'asc' | 'desc', ref_summaries: 0, tags: [] as string[] });

const COLORS = ['#c23a30', '#2d6a4f', '#2f4858', '#8a6d3b', '#6baed6'];

async function load() {
  const r = await api.collections();
  collections.value = r.collections;
  loaded.value = true;
}
onMounted(async () => {
  try {
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
  api.tags().then((r) => (suggestions.value = r.tags.map((t: Tag) => t.name))).catch(() => {});
});

function openCreate() {
  creating.value = true;
  editing.value = null;
  Object.assign(form, { title: '', slug: '', summary: '', theme_color: '#c23a30', sort_order: 0, post_order: 'desc', ref_summaries: 0, tags: [] });
}

async function openEdit(c: Collection) {
  editing.value = c;
  creating.value = false;
  Object.assign(form, {
    title: c.title,
    slug: c.slug,
    summary: c.summary,
    theme_color: c.theme_color,
    sort_order: c.sort_order,
    post_order: c.post_order,
    ref_summaries: c.ref_summaries ?? 0,
    tags: [],
  });
  try {
    const { tags } = await api.collection(c.id);
    form.tags = tags.map((t) => t.name);
  } catch {
    form.tags = [];
  }
}

async function save() {
  if (!form.title.trim()) return emit('notify', '文集名不可为空', true);
  try {
    if (creating.value) {
      await api.createCollection({ ...form });
      emit('notify', '文集已立');
    } else if (editing.value) {
      await api.updateCollection(editing.value.id, { ...form });
      emit('notify', '文集已改');
    }
    editing.value = null;
    creating.value = false;
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function remove(c: Collection) {
  if (!confirm(`确要撤下文集「${c.title}」？其下文章将归为未分类。`)) return;
  try {
    await api.deleteCollection(c.id);
    emit('notify', '文集已撤');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">文 集</span>
    <h1>诸集目录</h1>
  </div>

  <div class="card" v-if="loaded">
    <div class="card-head">
      <h2>文集（{{ collections.length }}）</h2>
      <button class="btn btn-primary" @click="openCreate">立新集</button>
    </div>

    <div class="table-wrap">
      <table class="table" v-if="collections.length">
        <thead>
          <tr>
            <th>序</th>
            <th>文集名</th>
            <th>简介</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in collections" :key="c.id">
            <td>{{ c.sort_order }}<span v-if="c.post_order === 'asc'" title="集内文章旧在前（正读）" style="color:var(--ink-light);font-size:0.75rem;">·正读</span></td>
            <td class="title-cell">
              <span class="color-dot" :style="{ background: c.theme_color }"></span>{{ c.title }}
              <span style="color:var(--ink-light);font-size:0.78rem;">/{{ c.slug }}</span>
            </td>
            <td style="color:var(--ink-mid);">{{ c.summary || '—' }}</td>
            <td>
              <div class="actions">
                <button class="btn btn-ghost mini" @click="openEdit(c)">改</button>
                <button class="btn btn-danger mini" @click="remove(c)">撤</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!collections.length" class="empty">尚无文集。</div>
  </div>

  <div v-if="creating || editing" class="card pad" style="margin-top:20px;">
    <div class="card-head" style="padding:0 0 16px;border-bottom:1px solid var(--hairline);margin-bottom:18px;">
      <h2>{{ creating ? '立新集' : '改文集' }}</h2>
    </div>
    <form @submit.prevent="save">
      <div class="form-row">
        <div class="field">
          <label>文集名 *</label>
          <input v-model="form.title" class="input" placeholder="如：随笔" />
        </div>
        <div class="field">
          <label>URL 标识（可留空自动生成）</label>
          <input v-model="form.slug" class="input" placeholder="essays" />
        </div>
      </div>
      <div class="field">
        <label>简介</label>
        <textarea v-model="form.summary" class="textarea" placeholder="一句话道尽此集风骨"></textarea>
      </div>
      <div class="form-row">
        <div class="field">
          <label>主题色</label>
          <select v-model="form.theme_color" class="select">
            <option v-for="c in COLORS" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <label>排序（小者在前）</label>
          <input v-model.number="form.sort_order" class="input" type="number" />
        </div>
        <div class="field">
          <label>集内文章顺序</label>
          <select v-model="form.post_order" class="select">
            <option value="desc">新在前（博客）</option>
            <option value="asc">旧在前（小说连载顺读）</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">
          <input v-model.number="form.ref_summaries" type="checkbox" :true-value="1" :false-value="0" />
          参考前文摘要（AI 生成时参考该文集最近 3 篇已刊文章的摘要风格）
        </label>
      </div>
      <div class="field">
        <label>标签（其下文章默认继承）</label>
        <TagChips v-model="form.tags" :suggestions="suggestions" placeholder="回车添加题材标签" />
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-primary" type="submit">落印</button>
        <button class="btn btn-ghost" type="button" @click="creating = false; editing = null">罢笔</button>
      </div>
    </form>
  </div>
</template>