import type { APIContext } from 'astro';
import { envOf, exportFullSnapshot } from '../../../lib/db';
import { requireAuth } from '../../../lib/auth';

export const prerender = false;

// 全量数据导出（只读快照）：仅登录可用；no-store 禁止 CDN 缓存。
// 导出不包含密码、会话、密钥与 R2 二进制；本接口不承诺可恢复导入。
export async function GET(ctx: APIContext): Promise<Response> {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;

  const env = await envOf();
  const snapshot = await exportFullSnapshot(env.DB);
  const date = snapshot.generated_at.slice(0, 10);

  return new Response(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="blog-export-${date}.json"`,
    },
  });
}
