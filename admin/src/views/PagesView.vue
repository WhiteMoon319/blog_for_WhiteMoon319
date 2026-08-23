<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
﻿<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

interface PageItem {
  id: number;
  slug: string;
  title: string;
  content_md: string;
  published: number;
  updated_at: string;
}

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const pages = ref<PageItem[]>([]);
const loaded = ref(false);
const editId = ref<number | null>(null);

const form = ref({ slug: '', title: '', content_md: '', published: 0 });
const saving = ref(false);
const showEditor = ref(false);

async function load() {
  try {
    const r = await api.pages(true);
    pages.value = r.pages;
    loaded.value = true;
  } catch (e) {
    emit('notify', (e as Error).message, true);
    loaded.value = true;
  }
}
onMounted(() => { load(); });

function openNew() {
  editId.value = null;
  form.value = { slug: '', title: '', content_md: '', published: 0 };
  showEditor.value = true;
}

async function openEdit(id: number) {
  try {
    const r = await api.page(id);
    const p = r.page;
    editId.value = p.id;
    form.value = { slug: p.slug, title: p.title, content_md: p.content_md, published: p.published };
    showEditor.value = true;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

function cancel() {
  showEditor.value = false;
  editId.value = null;
}

async function save() {
  if (!form.value.title.trim()) { emit('notify', '标题不可为空', true); return; }
  if (!form.value.slug.trim()) { emit('notify', 'slug 不可为空', true); return; }
  saving.value = true;
  try {
    if (editId.value) {
      await api.updatePage(editId.value, form.value);
      emit('notify', '已保存');
    } else {
      await api.createPage(form.value);
      emit('notify', '已创建');
    }
    showEditor.value = false;
    editId.value = null;
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function togglePublish(p: PageItem) {
  try {
    await api.updatePage(p.id, { published: p.published ? 0 : 1 });
    emit('notify', p.published ? '已下线' : '已发布');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function deleteOne(id: number) {
  if (!confirm('确认删除此页面？不可恢复。')) return;
  try {
    await api.deletePage(id);
    emit('notify', '已删除');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">页 面</span>
    <h1>静态页管理</h1>
    <button class="btn btn-primary" style="margin-left:auto;" @click="openNew">新建页面</button>
  </div>

  <div v-if="!loaded" style="text-align:center;padding:40px 0;color:var(--ink-light);">加载中…</div>

  <template v-else>
    <table class="table card pad" v-if="pages.length && !showEditor">
      <thead>
        <tr>
          <th>标题</th>
          <th>slug</th>
          <th>状态</th>
          <th>更新时间</th>
          <th style="width:180px;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in pages" :key="p.id">
          <td>{{ p.title }}</td>
          <td>{{ p.slug }}</td>
          <td>
            <span class="tag" :class="p.published ? 'tag-published' : 'tag-draft'">
              {{ p.published ? '已发布' : '草稿' }}
            </span>
          </td>
          <td style="font-size:0.82rem;color:var(--ink-light);">{{ p.updated_at?.slice(0, 10) }}</td>
          <td>
            <div class="actions">
              <button class="btn btn-ghost mini" @click="openEdit(p.id)">编</button>
              <button class="btn btn-ghost mini" @click="togglePublish(p)">
                {{ p.published ? '下线' : '发布' }}
              </button>
              <button class="btn btn-ghost mini" style="color:var(--cinnabar);" @click="deleteOne(p.id)">删</button>
              <a class="btn btn-ghost mini" :href="`/pages/${p.slug}`" target="_blank" v-if="p.published">看</a>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="card pad" v-if="!pages.length && !showEditor">
      <p style="color:var(--ink-light);">暂无页面</p>
    </div>

    <div class="card pad" v-if="showEditor">
      <h3 style="margin:0 0 20px;">{{ editId ? '编辑页面' : '新建页面' }}</h3>
      <div class="field">
        <label>标题</label>
        <input v-model="form.title" maxlength="200" class="input" />
      </div>
      <div class="field">
        <label>slug</label>
        <input v-model="form.slug" maxlength="120" class="input" />
      </div>
      <div class="field">
        <label>正文（Markdown）</label>
        <textarea v-model="form.content_md" class="textarea" rows="12" />
      </div>
      <div class="field">
        <label>发布状态</label>
        <select v-model="form.published" class="select">
          <option :value="0">草稿</option>
          <option :value="1">已发布</option>
        </select>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:20px;">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button class="btn btn-ghost" @click="cancel">取消</button>
      </div>
    </div>
  </template>
</template>