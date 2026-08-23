// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { requireAuth, json } from '../../lib/auth.ts';
import { envOf } from '../../lib/db';
import { renderMarkdown } from '../../lib/markdown.ts';
import { checkCsrf } from '../../lib/auth.ts';

export const prerender = false;

const MAX_BODY_BYTES = 1024 * 1024 * 4;

// POST /api/render { md } → { html, toc } — 渲染 Markdown 供 admin 源码模式实时预览（仅管理员）。
// 与公开站点共用 renderMarkdown，保证预览即所见。
export async function POST(ctx: APIContext): Promise<Response> {
  const csrfOk = await checkCsrf(ctx, (await envOf()).SITE_URL);
  if (!csrfOk) return json({ error: 'CSRF 校验失败' }, 403);
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const contentLength = Number(ctx.request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) return json({ error: '内容过长' }, 413);

  const body = (await ctx.request.json().catch(() => null)) as { md?: unknown } | null;
  const md = typeof body?.md === 'string' ? body.md : '';
  if (md.length > 4_000_000) return json({ error: '内容过长' }, 413);

  const { html, toc } = renderMarkdown(md);
  return json({ html, toc });
}