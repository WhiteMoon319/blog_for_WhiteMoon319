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