<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { onMounted } from 'vue';
onMounted(() => {
  window.location.href = '/login/?redirect=/admin/';
});
</script>
<template>
  <div class="login-wrap">
    <p>正在跳转至统一登录页…</p>
  </div>
</template>