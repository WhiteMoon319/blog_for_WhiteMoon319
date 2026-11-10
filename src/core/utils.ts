// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

// 主题可用的纯函数白名单（无 DB / env 访问）。经 @core/utils 引用。

export { postHref } from '../lib/utils.ts';
export { fmtDate, yearOf } from '../lib/db/utils.ts';

/**
 * 全文排版预设 → 正文容器 class（空串表示沿用主题默认）。
 * 白名单与核心解析保持一致：非法值一律视为默认，避免未知 class 落到页面上。
 * 样式定义在 @core/blocks.css 的 .article-body.layout-* 下。
 */
export function articleLayoutClass(layout: string | null | undefined): string {
  return layout === 'wechat' || layout === 'magazine' || layout === 'warm' ? `layout-${layout}` : '';
}

/**
 * 从公安备案号里抽出查询用的编号。
 *
 * 公安备案查询页要的是纯数字编号（如 50022302000935），
 * 而用户填进来的通常是完整文案（渝公网安备50022302000935号）。
 * 规则：取最后一串连续 8 位以上数字。
 *
 * 抽不出来时返回空串，调用方应回退到「只链接到查询首页」而不是拼一个错参数。
 */
export function mpsQueryCode(beian: string): string {
  if (!beian) return '';
  const matches = beian.match(/\d{8,}/g);
  return matches && matches.length > 0 ? matches[matches.length - 1] : '';
}
