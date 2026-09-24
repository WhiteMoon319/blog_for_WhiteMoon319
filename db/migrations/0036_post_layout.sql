-- 月下独酌 · blog（blog_for_WhiteMoon319）
-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later
-- 文章级排版预设：控制全篇节奏（字号/行距/字距/两端缩进/首行缩进）。
-- 空串表示沿用主题默认；可选值由应用层白名单校验（wechat / magazine / warm）。
-- 样式定义在核心 src/core/blocks.css 的 .article-body.layout-* 下，任何主题都生效。

ALTER TABLE posts ADD COLUMN layout TEXT NOT NULL DEFAULT '';
