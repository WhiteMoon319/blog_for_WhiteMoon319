// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
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

// 站点专属字体补丁（子集）——主题保持通用，这里按本站内容注入。
// site-fonts/ 不入库（用字集与子集字体取决于站点内容），存在时注入、缺失自动跳过。
const SITE_FONTS_PATCH = path.join(ROOT, 'site-fonts', 'ma-shan-zheng-subset.css');

function fontsBasePlugin() {
  return {
    name: 'fonts-base',
    enforce: 'pre',
    /** @param {string} code @param {string} id */
    transform(code, id) {
      if (!toId(id).endsWith('/styles/fonts.css')) return null;
      let out = code;
      // 追加站点专属子集：必须放在 879 条切片之后（同族同字重后声明者优先），
      // 这样常用字走 59KB 单文件，集外生僻字仍由原切片兜底
      if (existsSync(SITE_FONTS_PATCH)) {
        out += '\n' + readFileSync(SITE_FONTS_PATCH, 'utf8');
      }
      if (FONTS_BASE) {
        out = out.replaceAll("url('/api/files/fonts/", `url('${FONTS_BASE}/fonts/`);
      }
      return out === code ? null : out;
    },
  };
}

/**
 * 目标部署平台：决定用哪个 adapter。
 *
 *   cloudflare（默认）→ @astrojs/cloudflare，产出 Worker
 *   node              → @astrojs/node，产出可 `node entry.mjs` 启动的服务
 *
 * 用环境变量 BLOG_TARGET 选择，因为两个 adapter 的产物布局、构建流程、
 * 部署方式完全不同，没法在同一份产物里同时满足；而运行时差异
 * （env 获取、缓存）则已经在 src/lib/{platform,db/env,cache}.ts 里抹平了。
 *
 * 为什么默认 cloudflare：本项目的主线部署仍在 CF 上，Node 是可选路径。
 * 想构建 Node 版就显式设置 BLOG_TARGET=node。
 */
const TARGET = (envValue('BLOG_TARGET') || 'cloudflare').toLowerCase();
if (TARGET !== 'cloudflare' && TARGET !== 'node') {
  throw new Error(`BLOG_TARGET 只能是 cloudflare 或 node，当前为 "${TARGET}"`);
}
const nodeAdapter = TARGET === 'node' ? node({ mode: 'standalone' }) : null;
const cloudflareAdapter =
  TARGET === 'cloudflare' ? cloudflare({ platformProxy: { enabled: true }, imageService: 'passthrough' }) : null;

// 二选一：两个 adapter 的产物布局完全不同，不能同时挂
const adapter = nodeAdapter ?? cloudflareAdapter;

/**
 * Node 目标下把 `cloudflare:workers` 标记为外部依赖。
 *
 * src/lib/db/env.ts 里有一句 `import('cloudflare:workers')`（CF 分支用）。
 * Node 构建时 rolldown 会尝试解析这个裸协议并直接报错：
 *   Rolldown failed to resolve import "cloudflare:workers"
 *
 * 但这段代码在 Node 下永远不会执行到（先命中 __BLOG_ENV_RESOLVER__ 分支），
 * 所以把它标记为 external 即可：产物里保留 import() 语句，
 * 运行时不触发就不会报错，触发时也能给出清晰错误。
 *
 * Cloudflare 目标不需要这个设置——那边的 adapter 自己认这个协议。
 */
const nodeExternals = TARGET === 'node' ? ['cloudflare:workers'] : [];

/**
 * 两个目标各取所需：
 * - node 只要 cloudflare:workers（其余内置模块由 Node 运行时直接给）
 * - cloudflare 不能把 cloudflare:workers 列进来（那边 adapter 自己认）
 */
const externals = TARGET === 'node' ? nodeExternals : [];

/**
 * 给用到 __require 的 chunk 注入 createRequire。
 *
 * sanitize-html / nodemailer / postcss 这些 CJS 依赖被内联进产物后，rolldown 把
 * 它们内部的 require('path') 之类编译成 __require('path')。__require 的定义是
 *
 *   var __require = ((x) => typeof require !== "undefined" ? require : ...)(function (x) {
 *     if (typeof require !== "undefined") return require.apply(this, arguments);
 *     throw Error('Calling `require` for "' + x + '" ...');
 *   });
 *
 * 也就是先探测模块作用域里有没有 require。workerd 的 ESM 模块没有这个绑定，
 * 哪怕开了 nodejs_compat 也一样——那边只保证 CJS 模块能用 require。所以探测
 * 失败，直接 throw，chunk 一加载就崩，CF 路径的 e2e 全红。
 *
 * 修法是在 chunk 顶部补一个模块作用域的 require。workerd 的 nodejs_compat 提供
 * node:module，用 createRequire(import.meta.url) 就能拿到。__require 的探测此时
 * 命中，require('path') 走 nodejs_compat 的 node:path 实现。
 *
 * 只加在真正含 __require 的 chunk 上，别的 chunk 不动。
 */
function createRequireShim() {
  return {
    name: 'bwm:create-require-shim',
    apply: 'build',
    // 必须用 generateBundle 而不是 renderChunk：在 renderChunk 里拼上去的
    // `const require = ...` 会被 rolldown 当成未使用变量做 DCE 删掉，
    // 只剩一句孤零零的 createRequire() 调用，require 仍然不存在。
    // generateBundle 拿到的是定稿字符串，改完直接写进产物。
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        // 注入点是 __require 的 *定义* 所在 chunk，不是调用它的 chunk。
        // __require 在定义时就地做了 `typeof require !== "undefined"` 探测，
        // 捕获的是那个模块的 require 绑定；给 markdown / email 注入无效，
        // 因为报错发生在 rolldown-runtime 那侧的闭包里。
        if (!file.code.includes('__require =')) continue;
        file.code =
          "import { createRequire as __bwmRequire } from 'node:module';\n" +
          'const require = __bwmRequire(import.meta.url);\n' +
          file.code;
      }
    },
  };
}

export default defineConfig({
  output: 'server',
  adapter,
  vite: {
    plugins: [themeResolver(), fontsBasePlugin(), createRequireShim()],
    build: { rollupOptions: { external: externals } },
    // 把字体外链前缀也交给服务端代码（SiteHead 用它决定 CSP 的 font-src）
    define: {
      'import.meta.env.FONTS_BASE': JSON.stringify(FONTS_BASE),
    },
  },
});
