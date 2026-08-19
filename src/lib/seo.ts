// SEO 工具：RSS XML 转义与 JSON-LD 安全序列化。

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// JSON-LD 内嵌 <script> 时转义 < ，避免 </script> 提前闭合（标准 JSON.stringify 不转义 /）。
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
