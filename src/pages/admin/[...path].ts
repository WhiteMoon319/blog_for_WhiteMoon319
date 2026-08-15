import type { APIContext } from 'astro';
import adminHtml from '../../../admin/dist/index.html?raw';

export const prerender = false;

export function GET(_ctx: APIContext): Response {
  return new Response(adminHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}