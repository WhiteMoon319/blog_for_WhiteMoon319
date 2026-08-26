// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 主题切换 CLI：
//   pnpm theme            列出可用主题（标注当前激活）
//   pnpm theme <slug>     切换主题：写 .env 的 BLOG_THEME、更新 tsconfig paths/exclude
//
// 系统保护主题：classic 永远存在且回退链依赖它，禁止删除/改名。

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEMES_DIR = path.join(ROOT, 'src', 'themes');
const ENV_FILE = path.join(ROOT, '.env');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');

const CORE_TEMPLATES = ['home', 'collection', 'post', 'standalone', 'archive', 'search', 'not-found', 'tag-index', 'tag-detail'];
const SYSTEM_THEMES = ['classic'];

const info = (s) => console.log(`\u2139  ${s}`);
const ok = (s) => console.log(`\u2705 ${s}`);
const err = (s) => console.log(`\u274c ${s}`);

function listThemes() {
  if (!existsSync(THEMES_DIR)) return [];
  const out = [];
  for (const name of readdirSync(THEMES_DIR)) {
    const p = path.join(THEMES_DIR, name);
    if (statSync(p).isDirectory() && existsSync(path.join(p, 'theme.json'))) out.push(name);
  }
  return out.sort();
}

function readActiveFromEnv() {
  if (!existsSync(ENV_FILE)) return '';
  const m = /^BLOG_THEME=(.+)$/m.exec(readFileSync(ENV_FILE, 'utf8'));
  return m ? m[1].trim() : '';
}

/** astro.config 的默认解析：BLOG_THEME > modern > classic */
function resolveDefaultActive() {
  const envTheme = readActiveFromEnv();
  const all = listThemes();
  if (envTheme && all.includes(envTheme)) return envTheme;
  if (all.includes('modern')) return 'modern';
  if (all.includes('classic')) return 'classic';
  return '';
}

function validate(slug) {
  const dir = path.join(THEMES_DIR, slug);
  const problems = [];
  if (!existsSync(dir)) problems.push(`目录不存在：src/themes/${slug}`);
  if (!existsSync(path.join(dir, 'theme.json'))) problems.push('缺少 theme.json');
  else {
    try {
      const manifest = JSON.parse(readFileSync(path.join(dir, 'theme.json'), 'utf8'));
      if (manifest.slug !== slug) problems.push(`theme.json.slug(${manifest.slug}) 与目录名不一致`);
      if (SYSTEM_THEMES.includes(slug) === false && !/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
        problems.push('slug 需匹配 ^[a-z0-9][a-z0-9-]{1,30}$');
      }
    } catch (e) {
      problems.push(`theme.json 解析失败：${e.message}`);
    }
  }
  if (!existsSync(path.join(dir, 'layouts', 'BaseLayout.astro'))) problems.push('缺少 layouts/BaseLayout.astro（硬必需）');
  const missingTemplates = CORE_TEMPLATES.filter((t) => !existsSync(path.join(dir, 'templates', `${t}.astro`)));
  return { problems, missingTemplates };
}

function writeEnvTheme(slug) {
  let content = '';
  if (existsSync(ENV_FILE)) content = readFileSync(ENV_FILE, 'utf8');
  if (/^BLOG_THEME=.*/m.test(content)) {
    content = content.replace(/^BLOG_THEME=.*/m, `BLOG_THEME=${slug}`);
  } else {
    content = content.replace(/\n*$/, '\n') + `BLOG_THEME=${slug}\n`;
  }
  atomicWrite(ENV_FILE, content);
}

/** 先写临时文件再原子改名，避免进程中断留下半截文件 */
function atomicWrite(file, content) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

function writeTsconfigFor(active) {
  const raw = readFileSync(TSCONFIG, 'utf8');
  const json = JSON.parse(raw);
  json.compilerOptions = json.compilerOptions || {};
  json.compilerOptions.paths = {
    '@core/*': ['./src/core/*'],
    '@theme/*': [`./src/themes/${active}/*`, './src/themes/classic/*'],
  };
  // 排除未激活的非保护主题，避免半成品打红 astro check
  const excluded = listThemes().filter((t) => t !== active && t !== 'classic').map((t) => `src/themes/${t}`);
  json.exclude = ['dist', 'admin', 'node_modules', ...excluded];
  atomicWrite(TSCONFIG, JSON.stringify(json, null, 2) + '\n');
}

async function main() {
  const arg = process.argv[2];
  const themes = listThemes();

  if (!arg) {
    const active = resolveDefaultActive();
    console.log('\n可用主题：');
    for (const t of themes) {
      const marker = t === active ? '\u2190 当前激活' : '';
      const sys = SYSTEM_THEMES.includes(t) ? '（系统回退主题）' : '';
      console.log(`  - ${t}${sys} ${marker}`);
    }
    console.log(`\n切换：pnpm theme <slug>   未设置时默认：${resolveDefaultActive() || '(无)'}`);
    return;
  }

  const slug = arg;
  if (themes.length === 0 || !themes.includes(slug)) {
    err(`未知主题「${slug}」。可用：${themes.join(', ') || '(无)'}`);
    process.exit(1);
  }

  const { problems, missingTemplates } = validate(slug);
  if (problems.length > 0) {
    err('主题校验失败：');
    for (const p of problems) console.log(`   - ${p}`);
    process.exit(1);
  }
  if (missingTemplates.length > 0) {
    info('以下模板缺失，运行时将逐文件回退 classic：');
    console.log(`   - ${missingTemplates.join('\n   - ')}`);
  }

  writeEnvTheme(slug);
  writeTsconfigFor(slug);
  ok(`已切换到「${slug}」（.env: BLOG_THEME=${slug}，tsconfig paths 已更新）`);
  info('若 dev server 正在运行请重启；VSCode 用户建议 Reload Window / Restart TS Server。');
}

main();
