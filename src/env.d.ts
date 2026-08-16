/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      IMAGES: R2Bucket;
      ASSETS: Fetcher;
      RATE_LIMIT: KVNamespace;
      SITE_NAME: string;
      SITE_SLOGAN: string;
      SITE_POEM: string;
      SITE_URL: string;
      BLOG_ADMIN_PASSWORD: string;
      BLOG_SESSION_SECRET: string;
      R2_PUBLIC_URL: string;
      LOGIN_RATE_LIMIT_MAX: number;
      LOGIN_RATE_LIMIT_WINDOW: number;
    }
  }

  interface Env extends Cloudflare.Env {}
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

export {};