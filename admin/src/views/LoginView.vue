<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api';
import { setAuthed } from '../store/auth';

const router = useRouter();
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  if (!password.value || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await api.login(password.value);
    setAuthed(true);
    router.push('/');
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 429
        ? '尝试过于频繁，请稍后再试。'
        : '口令有误，请重试。';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <div class="seal">签</div>
      <h1>主人书案</h1>
      <p class="sub">BLOG ADMIN</p>
      <div class="field" style="text-align:left;">
        <label for="pwd">口令</label>
        <input
          id="pwd"
          v-model="password"
          class="input"
          type="password"
          placeholder="请输入管理口令"
          autocomplete="current-password"
        />
      </div>
      <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;" :disabled="loading">
        {{ loading ? '验印中…' : '入内' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>