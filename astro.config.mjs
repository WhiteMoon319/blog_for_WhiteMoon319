// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.join(ROOT, 'src', 'themes');

/** 主题解析：环境变量 BLOG_THEME > .env 的 BLOG_THEME > modern > classic */
function resolveActiveTheme() {
  let wanted = process.env.BLOG_THEME || '';
  if (!wanted) {
    const envFile = path.join(ROOT, '.env');
    if (existsSync(envFile)) {
      const m = /^BLOG_THEME=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
      if (m) wanted = m[1].trim();
    }
  }
  if (wanted && existsSync(path.join(THEMES_DIR, wanted, 'theme.json'))) return wanted;
  if (existsSync(path.join(THEMES_DIR, 'modern', 'theme.json'))) return 'modern';
  if (existsSync(path.join(THEMES_DIR, 'classic', 'theme.json'))) return 'classic';
  throw new Error('src/themes 下不存在任何含 theme.json 的主题');
}

/** @theme/* 别名：激活主题优先，缺失文件逐个回退 classic（文件级覆盖/继承） */
function themeResolver() {
  const active = resolveActiveTheme();
  const order = [...new Set([active, 'classic'])];
  const exts = ['', '.astro', '.ts', '.mts', '.css', '.json'];
  return {
    name: 'theme-resolver',
    enforce: 'pre',
    /** @param {string} source */
    resolveId(source) {
      let m = /^@core\/(.+)$/.exec(source);
      if (m) {
        const p = path.join(ROOT, 'src', 'core', m[1]);
        for (const ext of exts) if (existsSync(p + ext)) return toId(p + ext);
        return null;
      }
      m = /^@theme\/(.+)$/.exec(source);
      if (!m) return null;
      for (const t of order) {
        for (const ext of exts) {
          const p = path.join(THEMES_DIR, t, m[1] + ext);
          if (existsSync(p)) return toId(p);
        }
      }
      return null;
    },
  };
}

/** 统一为 POSIX 斜杠：与 Vite 默认解析的模块 id 一致，否则 .astro 的 script/style 虚拟子模块在运行时对不上号 */
function toId(p) {
  return p.split(path.sep).join('/');
}

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: 'passthrough',
  }),
  vite: {
    plugins: [themeResolver()],
  },
});