# 月下独酌 · blog

架在 Cloudflare 上的个人博客：前台访客展卷，后台主人落笔。文章以 Markdown 写就，可分文集（合集），支持发布/草稿切换、版本历史与图片直传。

## 功能

**前台**

- 首页：文集入口 + 最新文章
- 文集页 / 文章页：按文集组织文章；已收入文集的旧路径 `/posts/{slug}/` 永久 301 转跳文集路径，未收录则 404
- 标签：标签云、独立标签页 `/tags/{tag}/`、`/tags/?t=` 多标签交集检索、标签内关键词搜索
- 归档页（按时间轴）、关于页、站内搜索（`/search/`，`#标签` 前缀自动转跳标签页）
- 阅读量统计、上一篇/下一篇相邻导航、`/sitemap.xml` 动态生成
- 古风水墨视觉风格：纸纹背景、印章、毛笔标题、朱砂强调色、深色模式

**后台（`/admin`）**

- 密码登录（HMAC 签名会话 Cookie + 登录限流）
- 文集管理：新建/编辑/删除（名称、slug、简介、主题色）
- 文章管理：Tiptap 富文本编辑器，Markdown ↔ HTML 双向转换，发布/草稿切换，版本历史与回滚
- Word 文档（.docx）导入为 Markdown
- 图片管理：拖拽直传 R2，媒体库浏览/删除，封面与正文插图

## 技术栈

- **Astro 7**（`output: server`）+ **@astrojs/cloudflare** 适配器，SSR 运行在 **Cloudflare Workers**
- **Cloudflare D1**：文集、文章、版本历史与登录限流数据
- **Cloudflare R2**：上传图片
- **Vue 3 + Vite**：`admin/` 管理端 SPA，构建后合并进 Worker 静态资源（`dist/client/admin`）
- **marked + sanitize-html**：Markdown 渲染与 XSS 清洗
- **miniflare + node:test**：本地 e2e 测试

## 目录结构

```
admin/                   Vue 3 管理端 SPA（/admin/ 基路径，Tiptap 编辑器）
  src/views/             Login / Dashboard / Collections / Posts / Editor / Import / Media
  src/components/        版本历史面板、媒体选择弹窗
  src/lib/               Turndown 封装、内容风险检查
db/
  migrations/            D1 迁移（0001_init ~ 0012_fts_update_trigger）
  seed.sql               本地演示种子数据
  reset.sql              本地整库重置（cf:db:local 可重入）
scripts/
  cf-config.mjs          由模板 + .env 生成本地 wrangler.jsonc
  merge-admin.mjs        把 admin/dist 合并进 dist/client/admin
src/
  pages/                 页面与 API 路由（见下方「路由」）
  lib/                   db/（D1 访问，按域拆 9 模块）、api/validate.ts、认证、Markdown、上传等
  scripts/               collection-anim.ts（文集卡开合动画）
tests/                   node:test 单测；e2e 按域拆分（core/auth/posts/tags/media）+ helpers/e2e.ts
wrangler.jsonc.template  Workers 配置模板（占位符，可提交）
.env.example             真实资源 ID 的填法示例（占位符，可提交）
```

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页：文集与最新文章 |
| `/collections/{collectionSlug}/` | 文集页 |
| `/collections/{collectionSlug}/{postSlug}/` | 文章页（有文集的文章） |
| `/posts/{postSlug}/` | 文章页（无文集的文章；有文集的旧路径访问自动 301 到新结构） |
| `/archive/`、`/about/` | 归档、关于 |
| `/search/?q=` | 站内搜索；`#标签` 开头转跳标签页（多标签交集） |
| `/tags/` | 标签云（计数分文集/未分类文章） |
| `/tags/{tag}/` | 独立标签页；`/tags/?t=` 为内联页，多 `t` 取交集，`q` 为标签内关键词 |
| `/preview/{id}/` | 草稿预览（需登录，`noindex`） |
| `/sitemap.xml` | 站点地图（动态生成） |
| `/admin/...` | 管理端 SPA（login / dashboard / posts / editor / collections / import / media） |
| `/api/...` | 认证、文章、文集、版本、上传、媒体库等 JSON API |

API 一览：

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` `logout`，GET `/me` | 登录 / 注销 / 校验会话 | 登录 |
| GET/POST | `/api/collections`，GET/PUT/DELETE `/api/collections/{id}` | 文集 CRUD | 写需登录 |
| GET/POST | `/api/posts`，GET/PUT/DELETE `/api/posts/{id}` | 文章 CRUD（公开仅 published；PUT 带 `base_version` 乐观锁，过期 409；tags 严格校验：非法/超长/空标签或超过 20 个一律 400，且与正文写入同批原子） | 写需登录 |
| POST | `/api/posts/batch` | 批量创建/刊发/转草稿/移动/删除（单请求 ≤50，超限整体拒绝；slug 自动避让且 ≤63 字符；publish/draft/delete 单事务原子、状态变更留版本留档；move 全成功或全失败） | 登录 |
| GET/POST | `/api/posts/{id}/versions`，GET `/api/posts/{id}/versions/{version}`，POST `.../restore` | 版本历史与回滚 | 登录 |
| GET | `/api/tags` | 标签建议（云计数） | 公开 |
| POST | `/api/upload` | 图片上传 → R2（multipart） | 登录 |
| GET/DELETE | `/api/media` | 媒体库列表 / 删除 R2 对象 | 登录 |
| GET | `/api/files/[...key]` | R2 图片回源（带缓存头） | 公开 |

## 本地开发

要求：Node.js ≥ 22.12（Vite 7 / Astro 7 要求），已登录 wrangler（`pnpm run cf:login`）。

```bash
pnpm install          # pnpm workspace：一次安装根目录与 admin 全部依赖
```

**前台（astro dev）**

```bash
pnpm run dev          # http://localhost:4321
```

**前后台联调（Worker 本地跑构建产物）**

```bash
pnpm run cf:dev       # 生成配置 → 构建 → wrangler dev（默认 http://localhost:8787）
```

**管理端 SPA 单独开发**

```bash
pnpm run dev:admin    # Vite dev，http://localhost:5174，/api 代理到 127.0.0.1:8788
```

若要让管理端开发代理直连本地 Worker，请把 Worker 起在 8788 端口：

```bash
pnpm run cf:dev -- --port 8788
```

**本地 D1 初始化**（整库重建，可重复执行；会先清空本地库再应用迁移与种子）：

```bash
pnpm run cf:db:local  # db/reset.sql 重置 → 应用 db/migrations/*.sql → 导入 db/seed.sql
```

本地密钥（`BLOG_ADMIN_PASSWORD`、`BLOG_SESSION_SECRET`、`R2_PUBLIC_URL` 等）放在根目录 `.dev.vars`（不入库）。

## 资源配置

**真实资源 ID 不入库。** 提交的 `wrangler.jsonc.template` 只含占位符，本地 `wrangler.jsonc` 由脚本生成：

```bash
cp .env.example .env   # 填入真实 ID
pnpm run cf:config      # 生成 wrangler.jsonc（已被 .gitignore 忽略）
```

`.env` 需要两个值：

| 变量 | 说明 | 获取方式 |
| --- | --- | --- |
| `BLOG_D1_ID` | D1 数据库 ID | `npx wrangler d1 list` |

`pnpm run build` / `cf:dev` / `cf:deploy` 都会先自动执行 `cf:config`。未配置 `.env` 时生成的文件保留占位符：本地 miniflare 可正常启动，`wrangler deploy` 会因资源 ID 无效而明确失败，不会误指向其他资源。

### 绑定一览（Workers 侧）

| 绑定 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 文集/文章/版本历史 + 登录限流（`login_attempts` 表原子计数） |
| `IMAGES` | R2 | 上传图片 |
| `ASSETS` | Static Assets | `dist/client` 静态资源（含合并后的 admin SPA） |
| vars | `SITE_NAME` / `SITE_SLOGAN` / `SITE_POEM` / `SITE_URL` / `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW` | 站点配置 |

## 构建与测试

```bash
pnpm run build          # cf-config → admin 构建 → astro build → 合并 admin 产物
pnpm run typecheck      # astro check + vue-tsc + tsc（含 tests/**）
pnpm test               # 单测 + e2e（需要先 pnpm run build）
```

测试说明：`tests/fallback.test.ts` 校验管理端产物已合并进 `dist/client/admin`；`tests/consistency.test.ts` 覆盖原子写（slug 冲突整批回滚）、严格标签解析、删文集分批迁移与故障注入幂等续跑、FTS 触发器行为；e2e（`tests/e2e.*.test.ts`，公共引导在 `tests/helpers/e2e.ts`）用 miniflare 以全新 D1 应用迁移 + 种子后跑构建产物，覆盖首页、认证与限流、标签与交集检索、草稿预览、URL 结构、相邻导航、Markdown 清洗、上传白名单、批量事务、版本回滚与乐观锁等。e2e 引导会校验构建产物存在且不早于源码（`requireBuild`），改代码忘 build 会明确报错而非误测旧产物。

## 部署

前置：已按上文配置 `.env`（真实资源 ID），并已创建 D1 数据库 / R2 桶（或复用现有资源）。

```bash
pnpm run cf:deploy      # 生成配置 → 构建 → wrangler deploy
```

**首次部署后的数据准备（远程 D1）：**

```bash
npx wrangler d1 migrations apply blog-db --remote
npx wrangler d1 execute blog-db --remote --file=db/seed.sql   # 可选：演示种子
```

**生产密钥**（不入库，部署后设置一次即可；`R2_PUBLIC_URL` 为 R2 公共访问基地址，留空则图片经 Worker 回源）：

```bash
npx wrangler secret put BLOG_ADMIN_PASSWORD
npx wrangler secret put BLOG_SESSION_SECRET
npx wrangler secret put R2_PUBLIC_URL     # 可选：R2 公共域名，如 https://images.example.com
```

自定义域名在 Cloudflare 控制台绑定到该 Worker 即可；`routes` 里的 `custom_domain` 会被 wrangler 忽略，请勿在配置文件里配置。

## 数据库

- 迁移：`db/migrations/`，本地用 `pnpm run cf:db:local`，远程用 `wrangler d1 migrations apply --remote`
- 种子：`db/seed.sql`（仅本地演示用）
- 核心表：`collections`（文集）、`posts`（文章，含 `view_count`）、`post_versions`（编辑历史，可回滚）、`tags`/`post_tags`（标签：文章自有标签 + 文集继承标签，删除后孤儿标签自动清理）、`collection_deletes`（删文集分批迁移账本，迁移 0011）、`login_attempts`（登录限流计数）、`posts_fts`（FTS 全文检索虚拟表，迁移 0009；更新触发器仅 title/summary/content_md 变化时同步，迁移 0012）
- 文章 `slug` 在文集内唯一；未分类文章由部分唯一索引保证全局唯一（迁移 `0006_uncategorized_slug_unique.sql`）。删除文集时文章 `collection_id` 置空（文章保留，回到 `/posts/` 路径），若与现有未分类文章 slug 冲突，按 `(created_at, id)` 保留最新一篇原 slug，其余确定性追加 `-2`、`-3`… 后缀；成员超过 48 篇时分批迁移（进度记入 `collection_deletes`，失败可幂等续跑），每篇均留「文集删除迁移」版本；文集可设 `post_order`（`asc` 连载序 / `desc` 博客序，迁移 0008）