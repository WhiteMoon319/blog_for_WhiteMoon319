<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { ref } from 'vue';
import { api, download } from '../api';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const busy = ref(false);

async function exportJson() {
  busy.value = true;
  try {
    await download('/api/export', `blog-export-${new Date().toISOString().slice(0, 10)}.json`);
    emit('notify', '全量数据快照已导出');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">数 据</span>
    <h1>数据导出</h1>
  </div>

  <div class="card pad">
    <h3 style="margin:0 0 14px;">全量数据快照（JSON）</h3>
    <p style="color:var(--ink-mid);font-size:0.9rem;line-height:1.9;">
      包含文集、文章（含回收站，保留 deleted_at）、全部版本历史与标签关联，并标注 schema 与迁移版本。
      当前为<span style="color:var(--cinnabar);">只读导出</span>，不包含登录口令、会话、密钥与媒体文件本体；
      在导入功能落地前，请勿把它当作可一键恢复的备份。
    </p>
    <div style="display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="busy" @click="exportJson">
        {{ busy ? '导出中…' : '导出全量快照' }}
      </button>
      <span style="color:var(--ink-light);font-size:0.82rem;">
        单篇 Markdown 可从文章编辑器内导出
      </span>
    </div>
  </div>

  <div class="card pad" style="margin-top:20px;">
    <h3 style="margin:0 0 14px;">范围说明</h3>
    <ul style="color:var(--ink-mid);font-size:0.88rem;line-height:2.1;margin:0;padding-left:1.2em;">
      <li>密码、口令、会话 Cookie、签名密钥一律不进入导出文件。</li>
      <li>R2 图片本体不在导出范围；媒体迁移属专项功能。</li>
      <li>每次导出都记录生成时间与迁移版本，便于日后核对快照时点。</li>
    </ul>
  </div>
</template>
