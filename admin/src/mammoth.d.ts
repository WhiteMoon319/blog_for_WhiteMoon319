// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

declare module 'mammoth' {
  export interface ConvertImageOptions {
    convertImage: (image: DocxImage) => Promise<{ src: string } | null>;
  }

  export interface DocxImage {
    contentType: string;
    readAsArrayBuffer(): Promise<ArrayBuffer>;
  }

  export interface ConvertResult {
    value: string;
    messages: unknown[];
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer } & { convertImage?: ConvertImageOptions['convertImage'] }): Promise<ConvertResult>;

  export const images: {
    imgElement(cb: (image: DocxImage) => Promise<{ src: string } | null>): (image: DocxImage) => Promise<{ src: string } | null>;
  };
}