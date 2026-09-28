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

/** 读取 .env 里的某个键（与 resolveActiveTheme 同一套约定：环境变量 > .env） */
function envValue(key) {
  if (process.env[key]) return process.env[key].trim();
  const envFile = path.join(ROOT, '.env');
  if (!existsSync(envFile)) return '';
  const m = new RegExp(`^${key}=(.+)$`, 'm').exec(readFileSync(envFile, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/**
 * 字体切片的外链前缀（构建期变量）：
 *   FONTS_BASE 未设 ← 主题 CSS 里保持根路径 /api/files（可移植，本地开发与 fork 都成立）
 *   FONTS_BASE=https://static.example.com ← 切片改从 R2 自定义域直取，不再消耗 Worker 请求
 * 只做构建期改写，仓库里的 fonts.css 始终是相对路径（主题对外发布时不绑死任何人的域名）。
 */
const FONTS_BASE = envValue('FONTS_BASE').replace(/\/+$/, '');

function fontsBasePlugin() {
  return {
    name: 'fonts-base',
    enforce: 'pre',
    /** @param {string} code @param {string} id */
    transform(code, id) {
      if (!FONTS_BASE) return null;
      if (!toId(id).endsWith('/styles/fonts.css')) return null;
      return code.replaceAll("url('/api/files/fonts/", `url('${FONTS_BASE}/fonts/`);
    },
  };
}

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: 'passthrough',
  }),
  vite: {
    plugins: [themeResolver(), fontsBasePlugin()],
    // 把字体外链前缀也交给服务端代码（SiteHead 用它决定 CSP 的 font-src）
    define: {
      'import.meta.env.FONTS_BASE': JSON.stringify(FONTS_BASE),
    },
  },
});