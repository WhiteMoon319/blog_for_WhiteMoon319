# 一角书斋 · blog

架在 Cloudflare 上的个人博客：前台访客展卷，后台主人落笔。文章以 Markdown 写就，可分文集（合集），可发布/草稿切换。

## 技术栈

- **Astro 7**（`output: server`）+ **@astrojs/cloudflare** 适配器，SSR 运行在 **Cloudflare Workers**（非 Pages）
- **Cloudflare D1**：文集与文章数据
- **Cloudflare R2**：上传图片
- **Cloudflare KV**：`SESSION`（会话）、`RATE_LIMIT`（登录限流）
- **Vue 3 + Vite**：`admin/` 管理端 SPA，构建后合并进 Worker 静态资源（`dist/client/admin`）
- **marked + sanitize-html**：Markdown 渲染与 XSS 清洗
- **miniflare + node:test**：本地 e2e 测试

## 目录结构

```
admin/                  Vue 3 管理端 SPA（/admin/ 基路径）
db/
  migrations/            D1 迁移（0001_init.sql）
  seed.sql               本地演示种子数据
scripts/
  cf-config.mjs          由模板 + .env 生成本地 wrangler.jsonc
  merge-admin.mjs        把 admin/dist 合并进 dist/client/admin
src/
  pages/                 页面与 API 路由（见下方「路由」）
  lib/                   db 访问、认证、Markdown、工具函数
tests/                   node:test 单测与 e2e（miniflare 跑构建产物）
wrangler.jsonc.template  Workers 配置模板（占位符，可提交）
.env.example             真实资源 ID 的填法示例（占位符，可提交）
```

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页：文集与最新文章 |
| `/collections/{collectionSlug}/` | 文集页 |
| `/collections/{collectionSlug}/{postSlug}/` | 文章页（有文集的文章） |
| `/posts/{postSlug}/` | 文章页（无文集的文章；有文集的旧路径访问会自动 301 到新结构） |
| `/archive/`、`/about/` | 归档、关于 |
| `/admin/...` | 管理端 SPA（posts / editor / collections / login） |
| `/api/...` | 认证、文章、文集、上传、文件读取等 JSON API |

## 本地开发

要求：Node.js ≥ 20，已登录 wrangler（`npm run cf:login`）。

```bash
npm install          # 安装依赖（admin 依赖在其目录内自动安装）
```

**前台（astro dev）**

```bash
npm run dev          # http://localhost:4321
```

**前后台联调（Worker 本地跑构建产物）**

```bash
npm run cf:dev       # 生成配置 → 构建 → wrangler dev（默认 http://localhost:8787）
```

**管理端 SPA 单独开发**

```bash
npm run dev:admin    # Vite dev，http://localhost:5174，/api 代理到 127.0.0.1:8788
```

若要让管理端开发代理直连本地 Worker，请把 Worker 起在 8788 端口：

```bash
npm run cf:dev -- --port 8788
```

**本地 D1 初始化**（首次或换机器后，空库需要建表/种子）：

```bash
npm run cf:db:local  # 应用 db/migrations/0001_init.sql + db/seed.sql 到本地 D1
```

本地密钥（`BLOG_ADMIN_PASSWORD`、`BLOG_SESSION_SECRET` 等）放在根目录 `.dev.vars`（不入库）。

## 资源配置

**真实资源 ID 不入库。** 提交的 `wrangler.jsonc.template` 只含占位符，本地 `wrangler.jsonc` 由脚本生成：

```bash
cp .env.example .env   # 填入真实 ID
npm run cf:config      # 生成 wrangler.jsonc（已被 .gitignore 忽略）
```

`.env` 需要三个值：

| 变量 | 说明 | 获取方式 |
| --- | --- | --- |
| `BLOG_D1_ID` | D1 数据库 ID | `npx wrangler d1 list` |
| `BLOG_SESSION_KV_ID` | 会话 KV 命名空间 ID | `npx wrangler kv namespace list` |
| `BLOG_RATE_LIMIT_KV_ID` | 限流 KV 命名空间 ID | `npx wrangler kv namespace list` |

`npm run build` / `cf:dev` / `cf:deploy` 都会先自动执行 `cf:config`。未配置 `.env` 时生成的文件保留占位符：本地 miniflare 可正常启动，`wrangler deploy` 会因资源 ID 无效而明确失败，不会误指向其他资源。

### 绑定一览（Workers 侧）

| 绑定 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 文集/文章 |
| `IMAGES` | R2 | 上传图片 |
| `SESSION` | KV | 登录会话 |
| `RATE_LIMIT` | KV | 登录限流 |
| `ASSETS` | Static Assets | `dist/client` 静态资源（含合并后的 admin SPA） |
| vars | `SITE_NAME` / `SITE_SLOGAN` / `SITE_POEM` / `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW` | 站点配置 |

## 构建与测试

```bash
npm run build          # cf-config → admin 构建 → astro build → 合并 admin 产物
npm run typecheck      # astro check + vue-tsc
npm test               # 单测 + e2e（需要先 npm run build）
```

测试说明：`tests/fallback.test.ts` 校验管理端产物已合并进 `dist/client/admin`；e2e 用 miniflare 以全新 D1 应用迁移 + 种子后跑构建产物，覆盖首页、认证、限流、草稿、URL 结构、相邻导航、Markdown 清洗、上传白名单等。

## 部署

前置：已按上文配置 `.env`（真实资源 ID），并已创建 D1 数据库 / KV 命名空间 / R2 桶（或复用现有资源）。

```bash
npm run cf:deploy      # 生成配置 → 构建 → wrangler deploy
```

**首次部署后的数据准备（远程 D1）：**

```bash
npx wrangler d1 migrations apply blog-db --remote
npx wrangler d1 execute blog-db --remote --file=db/seed.sql   # 可选：演示种子
```

**生产密钥**（不入库，部署后设置一次即可）：

```bash
npx wrangler secret put BLOG_ADMIN_PASSWORD
npx wrangler secret put BLOG_SESSION_SECRET
```

自定义域名在 Cloudflare 控制台绑定到该 Worker 即可；`routes` 里的 `custom_domain` 会被 wrangler 忽略，请勿在配置文件里配置。

## 数据库

- 迁移：`db/migrations/`，本地用 `npm run cf:db:local`，远程用 `wrangler d1 migrations apply --remote`
- 种子：`db/seed.sql`（仅本地演示用）
- 文章 `slug` 全局唯一；删除文集时文章 `collection_id` 置空（文章保留，回到 `/posts/` 路径）