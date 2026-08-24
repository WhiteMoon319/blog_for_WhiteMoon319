# 月下独酌 · blog

架在 Cloudflare 上的个人博客：前台访客展卷，后台主人落笔。文章以 Markdown 写就，可分文集（合集），支持发布/草稿切换、版本历史、图片直传、AI 摘要生成。

## 功能

**前台**

- 首页：文集入口 + 最新文章
- 文集页 / 文章页：按文集组织文章；已收入文集的旧路径 `/posts/{slug}/` 永久 301 转跳文集路径，未收录则 404
- 标签：标签云、独立标签页 `/tags/{tag}/`、`/tags/?t=` 多标签交集检索、标签内关键词搜索
- 归档页（按时间轴）、关于页、站内搜索（`/search/`，`#标签` 前缀自动转跳标签页）
- 阅读量统计、上一篇/下一篇相邻导航、`/sitemap.xml` 动态生成
- KaTeX 数学公式、Mermaid 流程图、MarkMap 脑图服务端渲染 + 客户端运行时
- 代码高亮（highlight.js）、GFM 表格
- 古风水墨视觉风格：纸纹背景、印章、毛笔标题、朱砂强调色、深色模式

**后台（`/admin`）**

- 密码登录（HMAC 签名会话 Cookie + 登录限流）
- 文集管理：新建/编辑/删除（名称、slug、简介、主题色、参考前文摘要开关）
- 文章管理：Tiptap 富文本编辑器（可视化 + 源码双模式，CodeMirror Markdown 编辑 + 实时预览），表格/代码高亮/链接/图片，发布/草稿/定时/置顶
- AI 摘要生成：单篇生成（多候选可选）、批量生成（导入页/文章列表）、文集参考摘要、可配置 API Key（AES-256-GCM 加密存储）
- 版本历史：增量存储（unified diff），回滚，对比与词级高亮
- Word 文档（.docx）导入为 Markdown，导入后 AI 批量生成摘要
- 图片管理：拖拽直传 R2，媒体库浏览/删除，封面与正文插图
- 数据看板：阅读趋势、日聚合热文 TOP、统计字数

## 技术栈

- **Astro 7**（`output: server`）+ **@astrojs/cloudflare** 适配器，SSR 运行在 **Cloudflare Workers**
- **Cloudflare D1**：文集、文章、版本历史与登录限流数据
- **Cloudflare R2**：上传图片
- **Vue 3 + Vite**：`admin/` 管理端 SPA，构建后合并进 Worker 静态资源（`dist/client/admin`）
- **marked + sanitize-html**：Markdown 渲染与 XSS 清洗
- **KaTeX**：数学公式服务端渲染
- **Mermaid / MarkMap (d3)**：图表客户端运行时渲染
- **highlight.js**：代码语法高亮
- **TipTap (ProseMirror)**：WYSIWYG 编辑器（表格、代码块低亮）
- **CodeMirror 6**：源码模式 Markdown 编辑器
- **OpenAI-compatible API**：AI 摘要生成（DeepSeek / OpenAI / 自定义端点）
- **miniflare + node:test**：本地 e2e 测试

## 目录结构

```
admin/                   Vue 3 管理端 SPA（/admin/ 基路径，TipTap 编辑器）
  src/views/             Login / Dashboard / Collections / Posts / Editor / Import / Media / Stats / Settings
  src/components/        VersionPanel（版本对比）、MediaPickerModal、TagChips
  src/lib/               Turndown 封装、内容风险检查、import 解析、drafts 草稿自动保存
db/
  migrations/            D1 迁移（0001_init ~ 0025_post_summary_source）
  seed.sql               本地演示种子数据
  reset.sql              本地整库重置（cf:db:local 可重入）
scripts/
  cf-config.mjs          由模板 + .env 生成本地 wrangler.jsonc
  merge-admin.mjs        把 admin/dist 合并进 dist/client/admin
  build-worker.mjs       生成 scheduled-worker.mjs 包装入口
src/
  pages/                 页面与 API 路由（见下方「路由」）
  lib/                   db/（D1 访问，按域拆 10 模块）、ai.ts（AI 调用适配层）、ai-credentials.ts（AES-256-GCM）、markdown.ts（KaTeX/Mermaid/MarkMap/hljs）、auth.ts、utils.ts 等
  components/            ArticleEnhancer.astro（mermaid/markmap 运行时渲染）
  styles/                tokens.css、base.css
tests/                   node:test 单测 + e2e（按域拆分）
wrangler.jsonc.template  Workers 配置模板（占位符，可提交）
.env.example             真实资源 ID 的填法示例
```

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页：文集与最新文章 |
| `/collections/{collectionSlug}/` | 文集页 |
| `/collections/{collectionSlug}/{postSlug}/` | 文章页（有文集的文章） |
| `/posts/{postSlug}/` | 文章页（无文集的文章；有文集的旧路径访问自动 301） |
| `/archive/`、`/about/` | 归档、关于 |
| `/search/?q=` | 站内搜索；`#标签` 开头转跳标签页 |
| `/tags/` | 标签云 |
| `/tags/{tag}/`；`/tags/?t=` | 独立标签页；多 `t` 取交集，`q` 为标签内关键词 |
| `/preview/{id}/` | 草稿预览（需登录，`noindex`） |
| `/sitemap.xml` | 站点地图（动态生成） |
| `/admin/...` | 管理端 SPA |

### API

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| POST/GET | `/api/auth/login` / `logout` / `me` | 登录 / 注销 / 校验会话 | 登录 |
| GET/POST | `/api/collections`，GET/PUT/DELETE `/api/collections/{id}` | 文集 CRUD | 写需登录 |
| GET/POST | `/api/posts`，GET/PUT/DELETE `/api/posts/{id}` | 文章 CRUD（PUT 带 `base_version` 乐观锁） | 写需登录 |
| POST | `/api/posts/batch` | 批量创建/刊发/转草稿/移动/删除 | 登录 |
| GET/POST | `/api/posts/{id}/versions`，GET/POST `.../{version}/restore` | 版本历史与回滚 | 登录 |
| GET | `/api/tags` | 标签云计数 | 公开 |
| POST | `/api/upload` | 图片上传 → R2 | 登录 |
| GET/DELETE | `/api/media` | 媒体库 | 登录 |
| GET | `/api/files/[...key]` | R2 图片回源 | 公开 |
| GET/PUT | `/api/settings` | 站点设置 + AI 配置 | 登录 |
| POST | `/api/render` | 源码模式预览渲染（Markdown → HTML） | 登录 |
| GET | `/api/stats`，`/api/stats/corpus` | 阅读趋势与字数统计 | 登录 |
| POST | `/api/ai/summary` | 单篇 AI 摘要生成 | 登录 |
| GET | `/api/ai/models` | 获取模型列表 | 登录 |
| POST | `/api/ai/test` | 测试并保存 AI 配置 | 登录 |
| POST | `/api/ai/batch-summary` | 批量 AI 摘要生成 | 登录 |
| DELETE | `/api/settings/ai-key` | 清除 API Key | 登录 |

## 本地开发

要求：Node.js ≥ 22.12，已登录 wrangler（`pnpm run cf:login`）。

```bash
pnpm install
```

**前台（astro dev）**

```bash
pnpm run dev          # http://localhost:4321
```

**前后台联调**

```bash
pnpm run cf:dev       # 构建 → wrangler dev（默认 http://localhost:8787）
```

**管理端 SPA 单独开发**

```bash
pnpm run dev:admin    # Vite dev，http://localhost:5174，/api 代理到 127.0.0.1:8788
```

若要让管理端开发代理直连本地 Worker，请把 Worker 起在 8788 端口：

```bash
pnpm run cf:dev -- --port 8788
```

**本地 D1 初始化**

```bash
pnpm run cf:db:local
```

本地密钥放在根目录 `.dev.vars`（不入库，参考 `.env.example`）：

```
BLOG_ADMIN_PASSWORD = "admin123"
BLOG_SESSION_SECRET = "..."
R2_PUBLIC_URL = ""
SITE_URL = "http://localhost:5174"
AI_SETTINGS_ENCRYPTION_KEY = "..."   # 32 字节 hex，AES-256-GCM 加密主密钥
```

## 资源配置

**真实资源 ID 不入库。** `wrangler.jsonc` 由脚本从 `.env` 生成：

```bash
cp .env.example .env   # 填入真实 ID
pnpm run cf:config      # 生成 wrangler.jsonc（.gitignore 已忽略）
```

`.env` 需要：

| 变量 | 说明 | 获取方式 |
| --- | --- | --- |
| `BLOG_D1_ID` | D1 数据库 ID | `npx wrangler d1 list` |

### 绑定一览

| 绑定 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 全部数据 |
| `IMAGES` | R2 | 上传图片 |
| `ASSETS` | Static Assets | `dist/client` 静态资源 |
| vars | `SITE_NAME` / `SITE_SLOGAN` / `SITE_POEM` / `SITE_URL` / `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW` | 站点配置 |
| secret | `AI_SETTINGS_ENCRYPTION_KEY` | API Key 加密主密钥 |

## 构建与测试

```bash
pnpm run build          # cf-config → admin 构建 → astro build → 合并
pnpm run typecheck      # astro check + vue-tsc + tsc（含 tests/）
pnpm test               # 单测 + e2e（需先 pnpm run build）
```

## 部署

```bash
pnpm run cf:deploy      # 构建 → wrangler deploy
```

**首次部署数据准备：**

```bash
npx wrangler d1 migrations apply blog-db --remote
npx wrangler d1 execute blog-db --remote --file=db/seed.sql   # 可选种子
```

**生产密钥：**

```bash
npx wrangler secret put BLOG_ADMIN_PASSWORD
npx wrangler secret put BLOG_SESSION_SECRET
npx wrangler secret put R2_PUBLIC_URL
npx wrangler secret put AI_SETTINGS_ENCRYPTION_KEY   # AI 加密主密钥，32 字节 hex
```

## 数据库

- **迁移**：`db/migrations/0001_init` ~ `0025_post_summary_source`
- **核心表**：`collections`（文集，含 `ref_summaries`/`ai_prompt_id`）、`posts`（文章，含 `summary_source`/`view_count`/`is_pinned`/`scheduled_at`）、`post_versions`（增量版本，含 `summary_source`/`base_version`/`content_md_patch`）、`tags`/`post_tags`/`collection_tags`、`collection_deletes`（删文集分批迁移账本）、`login_attempts`、`posts_fts`（FTS 全文检索）、`ai_credentials`（AES-256-GCM 加密 API Key）、`settings`（站点与 AI 配置，含 `ai_prompt_templates`）
- **文章 slug**：文集内唯一；未分类由部分唯一索引保证全局唯一。删除文集时 slug 冲突自动加后缀

## AI 摘要

后台设置页可配置 AI 服务商、API 地址、API Key、模型、思考强度。API Key 使用 AES-256-GCM 加密存储，加密主密钥为 Worker Secret。

- 编辑器：单篇 AI 生成摘要
- 文章列表：批量生成（可强制覆盖现有摘要）
- 导入页：导入后批量生成
- 文集参考前文摘要：开启后 AI 生成时带同文集最近 3 篇已刊文章的摘要作为参考

### Prompt 模板

支持多套 AI 提示词模板，后台设置页可新增/编辑/删除：

- **博客摘要**（`overview`，默认）：100-200 字概括全文，适合杂文/随笔/技术文
- **章节导读**（`teaser`）：生成单章导读，回味标题、点出推进点、营造阅读氛围但不剧透，适合小说/连载

使用规则：

- 每套模板定义 `id`（标识）、`name`（名称）与 `prompt`（提示词）
- **文集**可指定使用哪套模板（文集编辑页「AI 摘要模板」下拉）
- 批量生成（文章列表/导入）按各文集自己的 `ai_prompt_id` 逐篇处理
- **编辑器**单篇生成默认跟随文集选择，可临时下拉切换
- 参考上文摘要：博客摘要模板注入会带「风格参考」语境；章节导读/自定义模板注入会带「前文衔接」语境（需文集开启「参考前文摘要」）

## 版本管理

- v1 全量快照，后续版本对最近一次全量快照存 unified diff
- 补丁超过正文 50% 或 128 字节时重新全量
- 读取时透明重建，版本史面板 diff 对比不受影响

## 开源协议

[GNU Affero General Public License v3.0（AGPL-3.0）](LICENSE)