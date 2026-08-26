// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 官方主题 zip 的多通道下载器：
//   1) raw.githubusercontent.com（直连）
//   2) api.github.com Contents API（免鉴权）
//   3) git 浅克隆（git 是本项目硬依赖，且继承系统代理配置）
// 任一成功即返回 Buffer；全部失败抛出汇总错误。

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function envRepo() {
  const root = resolve(import.meta.dirname, '..', '..');
  const envFile = join(root, '.env');
  if (existsSync(envFile)) {
    const m = /^THEMES_REPO=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
    if (m) return m[1].trim();
  }
  return 'WhiteMoon319/themes_for_blog';
}
export { envRepo };

async function viaRaw(repo, slug, ref) {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${slug}/${slug}.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`raw ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function viaApi(repo, slug, ref) {
  const url = `https://api.github.com/repos/${repo}/contents/${slug}/${slug}.zip?ref=${ref}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github.raw' } });
  if (!res.ok) throw new Error(`api ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function viaGitClone(repo, slug, ref) {
  if (!/^[A-Za-z0-9._\/-]{1,80}$/.test(ref)) throw new Error('非法 ref');
  const tmp = mkdtempSync(join(tmpdir(), 'themeclone-'));
  try {
    execSync(`git clone --depth 1 --branch "${ref}" "https://github.com/${repo}.git" "${tmp}/repo"`, {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const p = join(tmp, 'repo', slug, `${slug}.zip`);
    const buf = readFileSync(p);
    if (buf.length < 512) throw new Error('zip 内容异常（过小）');
    return buf;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 拉取官方主题 zip。
 * @param {string} slug
 * @param {{ref?: string, onChannel?: (name: string) => void}} [opts]
 */
export async function fetchOfficialZip(slug, opts = {}) {
  const ref = opts.ref || 'main';
  const repo = envRepo();
  const channels = [
    ['raw', () => viaRaw(repo, slug, ref)],
    ['api', () => viaApi(repo, slug, ref)],
    ['git-clone', () => viaGitClone(repo, slug, ref)],
  ];
  const errs = [];
  for (const [name, fn] of channels) {
    try {
      const buf = await fn();
      if (typeof opts.onChannel === 'function' && name !== 'raw') opts.onChannel(name);
      return buf;
    } catch (e) {
      errs.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`官方源所有下载通道均失败 → ${errs.join(' | ')}`);
}
