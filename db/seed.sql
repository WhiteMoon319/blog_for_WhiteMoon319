-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319
-- 演示种子数据（仅本地开发用）
INSERT INTO collections (title, slug, summary, theme_color, sort_order) VALUES
  ('随笔', 'essays', '日常琐记，流水账亦有真意。', '#c23a30', 1),
  ('技术', 'tech', '折腾笔记，从零到一。', '#2d6a4f', 2),
  ('读书', 'reading', '翻书偶得，摘句与短评。', '#2f4858', 3);

INSERT INTO posts (collection_id, title, slug, summary, content_md, status) VALUES
  (1, '第一篇：博客开张', 'first-post', '建站小记。',
'## 开张

用了 Cloudflare 全家桶搭了这间小书斋。

- 页面在 Cloudflare Workers
- 数据在 D1
- 图片在 R2

> 且把文章当茶煮。

`pnpm run dev` 即可本地开写。',
   'published'),
  (1, '草稿：未完待续', 'draft-post', '还没写完的一篇。', '## 未完\n\n此处留白。', 'draft'),
  (2, '把 Astro 架到 Cloudflare 上', 'astro-on-cloudflare', '部署流水账。',
'## 要点

1. 用 `@astrojs/cloudflare` 适配器，`output: server`
2. `wrangler.jsonc` 里绑定 D1 与 R2
3. `wrangler deploy` 一条龙上线

代码：

```ts
export default defineConfig({
  output: "server",
  adapter: cloudflare({ platformProxy: { enabled: true } }),
});
```',
   'published');