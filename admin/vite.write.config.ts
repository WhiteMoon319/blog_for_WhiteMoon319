// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 作者写作区（/write/）的独立构建：与 /admin/ 分开产物、分开 base，
// 使作者入口在结构上不与管理员后台共用页面与路由表。

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 产物入口统一叫 index.html：与 /admin 一致，便于服务端路由与构建产物校验
function renameEntry() {
  const outDir = fileURLToPath(new URL('./dist-write', import.meta.url));
  return {
    name: 'rename-write-entry',
    closeBundle() {
      const from = `${outDir}/write.html`;
      if (existsSync(from)) renameSync(from, `${outDir}/index.html`);
    },
  };
}

export default defineConfig({
  base: '/write/',
  plugins: [vue(), renameEntry()],
  build: {
    outDir: 'dist-write',
    emptyOutDir: true,
    rollupOptions: { input: { index: 'write.html' } },
  },
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
    },
  },
});
