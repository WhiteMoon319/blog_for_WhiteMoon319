// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 一键部署脚本：构建 → 远程迁移 → 部署 Worker
// 首次部署前需手动设置生产密钥（见 README 部署章节）。
// 使用：pnpm run deploy

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SEP = '='.repeat(56);

function run(cmd, label) {
  console.log(`\n${SEP}\n${label ?? cmd}\n${SEP}`);
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
}

/** 环境变量 > .env（与 astro.config.mjs、cf-config 同一套约定） */
function envValue(key) {
  if (process.env[key]) return process.env[key].trim();
  if (!existsSync('.env')) return '';
  const m = new RegExp(`^${key}=(.+)$`, 'm').exec(readFileSync('.env', 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** 取主题 fonts.css 里第一条切片路径（仓库里是 /api/files/fonts/... 的同源相对路径） */
function firstFontSlicePath() {
  const themesDir = 'src/themes';
  if (!existsSync(themesDir)) return null;
  for (const t of readdirSync(themesDir)) {
    const css = join(themesDir, t, 'styles', 'fonts.css');
    if (!existsSync(css)) continue;
    const m = /url\('(\/api\/files\/fonts\/[^']+)'\)/.exec(readFileSync(css, 'utf8'));
    if (m) return m[1];
  }
  return null;
}

/**
 * 字体外链预检：FONTS_BASE 指向 R2 自定义域时，该域必须回 Access-Control-Allow-Origin，
 * 否则浏览器会拦下全部切片、页面静默回退系统字体（跨域 webfont 的硬要求）。
 * 命中脏边缘缓存（缓存时还没有 CORS 头）也会在这里暴露。
 */
async function checkFontBase(base) {
  const slice = firstFontSlicePath();
  if (!slice) {
    console.log('⚠️  未在主题里找到 fonts.css 切片，跳过字体预检');
    return;
  }
  const url = base + slice.replace(/^\/api\/files/, '');
  let res;
  try {
    res = await fetch(url, {
      headers: { origin: 'https://deploy-preflight.invalid' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error(`❌ 字体预检失败：无法访问 ${url}（${e.message || e}）`);
    process.exit(1);
  }
  const acao = res.headers.get('access-control-allow-origin');
  if (!res.ok) {
    const hint =
      res.status === 404
        ? `   切片不存在：该域对应的桶里没有 ${slice.replace(/^\/api\/files\//, '')}。\n` +
          `   先补齐切片：pnpm fonts:sync（或自己跑 fonts-prepare + fonts-upload）`
        : `   该域不可达或路径不对（检查 FONTS_BASE 是否指向 R2 自定义域、前缀是否与桶里的目录一致）`;
    console.error(
      `❌ 字体预检失败：${url}\n   HTTP ${res.status}\n${hint}\n   跳过本检查：pnpm run deploy -- --skip-font-check`,
    );
    process.exit(1);
  }
  if (!acao) {
    console.error(
      `❌ 字体预检失败：${url}\n   HTTP ${res.status}，但缺 Access-Control-Allow-Origin\n` +
        `   FONTS_BASE 指向的域必须允许跨域取字体，否则浏览器会拦下全部切片、页面回退系统字体。\n` +
        `   设置 CORS：node node_modules/wrangler/bin/wrangler.js r2 bucket cors set blog-images --file r2-cors.json\n` +
        `   （R2 对象带 immutable 会被边缘缓存一年，且重传同 key 不会失效；若旧路径已脏，请推到新的路径前缀）\n` +
        `   跳过本检查：pnpm run deploy -- --skip-font-check`,
    );
    process.exit(1);
  }
  console.log(`✅ 字体外链预检通过：${url}（HTTP ${res.status}，CORS ${acao}）`);
}

// 0. 字体外链预检（站点未配 FONTS_BASE 时跳过：切片走本站路由，无跨域问题）
const FONTS_BASE = envValue('FONTS_BASE').replace(/\/+$/, '');
if (FONTS_BASE && !process.argv.includes('--skip-font-check')) {
  console.log(`\n${SEP}\n字体外链预检（FONTS_BASE=${FONTS_BASE}）\n${SEP}`);
  await checkFontBase(FONTS_BASE);
}

// 1. 构建
run('pnpm run build', '构建（cf-config + admin + astro + 合并）');

// 2. 远程迁移
console.log(`\n${SEP}\n远程 D1 迁移\n${SEP}`);
try {
  execSync('pnpm exec wrangler d1 migrations apply blog-db --remote', { stdio: 'inherit', cwd: process.cwd() });
} catch (e) {
  // 迁移失败必须终止：新表（如 reading_history）缺失时部署后页面会 500
  console.error('❌ 远程迁移失败，中止部署（请先排查 D1 迁移）：', e.message || e);
  process.exit(1);
}

// 3. 部署 Worker
run('pnpm exec wrangler deploy', '部署 Worker');

console.log(`\n${SEP}\n✅ 部署完成\n${SEP}`);
console.log('前台：https://blog.whitemoon319.xyz');
console.log('后台：https://blog.whitemoon319.xyz/admin/');
console.log(
  FONTS_BASE
    ? `字体切片：${FONTS_BASE}/fonts/…（构建期 FONTS_BASE，直取 CF CDN）`
    : '字体切片：本站 /api/files 路由（未配 FONTS_BASE；每页切片请求会消耗 Worker 调用）',
);
console.log(
  `\n首次部署或密钥轮换时还需执行：\n  pnpm exec wrangler secret put BLOG_ADMIN_PASSWORD\n  pnpm exec wrangler secret put BLOG_SESSION_SECRET\n  pnpm exec wrangler secret put R2_PUBLIC_URL\n  pnpm exec wrangler secret put AI_SETTINGS_ENCRYPTION_KEY\n  pnpm exec wrangler secret put SMTP_USER\n  pnpm exec wrangler secret put SMTP_PASS\n  pnpm exec wrangler secret put SMTP_FROM`,
);
