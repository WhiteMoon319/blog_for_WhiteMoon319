// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 把第三方 vendor CSS 复制到 public/_assets/，
// 供 ArticleEnhancer 按需条件加载（KaTeX/hljs 样式仅在正文含对应产物时输出 <link>）。
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('public/_assets', { recursive: true });
copyFileSync('node_modules/katex/dist/katex.min.css', 'public/_assets/katex.min.css');
copyFileSync('node_modules/highlight.js/styles/github-dark.css', 'public/_assets/github-dark.css');
console.log('vendor css copied to public/_assets/');
