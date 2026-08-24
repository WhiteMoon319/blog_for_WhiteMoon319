// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { APIContext } from 'astro';
import { checkCsrf, clearSessionCookie, json } from '../../../lib/auth';
import { envOf, incrementUserSessionVersion } from '../../../lib/db';

export const prerender = false;

// 注销：清 Cookie 并对该用户 session_version + 1，使已签发 token 立即失效
export async function POST(ctx: APIContext): Promise<Response> {
  const env = await envOf();
  if (!checkCsrf(ctx, env.SITE_URL)) {
    return json({ error: 'forbidden: invalid origin' }, 403);
  }
  const m = ctx.cookies.get('blog_session')?.value?.split('.')[0];
  let userId: number | null = null;
  if (m) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0))));
      const mm = parsed.sub?.match(/^user:(\d+)$/);
      if (mm) userId = Number(mm[1]);
    } catch { /* ignore */ }
  }
  if (userId !== null) {
    await incrementUserSessionVersion(env.DB, userId);
  }
  clearSessionCookie(ctx);
  return json({ ok: true });
}