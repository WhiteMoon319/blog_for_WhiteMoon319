# 月下独酌 · blog

架在 Cloudflare 上的个人博客：前台访客展卷，后台主人落笔。文章以 Markdown 写作，可分文集（合集），支持发布/草稿/定时切换、版本历史与回滚、图片直传 R2、AI 摘要生成、用户注册与评论互动。前台为 Astro SSR，后台为 Vue 3 单页应用，全部运行在 Cloudflare Workers + D1 + R2 之上。

## 功能

**前台**

- 首页（文集入口 + 最新文章）、文集页、文章页、归档页、关于页、站内搜索、独立页面（`/pages/{slug}/`）
- 文章支持发布/草稿/定时发布、置顶、SEO 字段（title/description/canonical）
- 文集内文章走 `/collections/{collection}/{postSlug}/` 路径；无文集的旧路径 `/posts/{slug}/` 自动 301
- 标签云、独立标签页、多标签交集检索、标签内关键词搜索
- 阅读量统计（日聚合 + 去重）、上一篇/下一篇相邻导航
- RSS（`/feed.xml`）、站点地图（`/sitemap.xml`）动态生成
- KaTeX 数学公式、Mermaid 流程图、MarkMap 脑图、代码高亮（highlight.js），均按需加载（正文含对应内容才拉取资源）
- 用户系统：注册（邮箱验证码）、登录（用户名或邮箱）、个人中心（昵称、头像、改密码、改邮箱、邮件提醒开关）
- 评论系统：嵌套回复、楼层号、文字 + 图片附件（R2）、点赞、敏感词人工审核
- 文章/评论点赞
- 边缘缓存：匿名公开页面 60s 边缘缓存 + 后台刷新；登录用户 no-store
- 主题系统：仓库内置 `modern`（默认，简约现代）与 `classic`（古风水墨）两套，深色模式，支持本地切换与从官方主题仓库安装更多（如 `starter` 起步模板、`wildfire` 野火等）

**后台（`/admin`）**

- 统一账号登录（与前台共用登录，按 role 判权限；非管理员访问后台 404）
- 数据看板：阅读趋势、日聚合热文 TOP、统计字数
- 文集管理：新建/编辑/删除（名称、slug、简介、主题色、参考前文摘要开关、AI 摘要模板）
- 文章管理：Tiptap 富文本编辑器（可视化 + 源码双模式，CodeMirror Markdown 编辑 + 实时预览），发布/草稿/定时/置顶，版本历史（diff 对比、回滚），Word（.docx）导入为 Markdown
- 独立页面管理：自定义页面（slug、标题、内容、发布开关）
- AI 摘要：单篇生成（多候选可选）、批量生成（列表/导入页）、文集参考摘要、可配置 API Key（AES-256-GCM 加密存储）
- 图片管理：拖拽直传 R2、媒体库浏览/删除、封面与正文插图
- 评论审核：待审/已准/已拒分栏、按文章筛选、批准/驳回/删除
- 用户管理：列表、封禁/解封（封禁即踢下线）
- 数据导出：全量 JSON 快照、单篇 Markdown 下载
- 站点设置：站点信息/文案、邮件（SMTP 或 HTTP API）、AI 配置、评论审核词

## 技术栈

- **Astro 7**（`output: server`）+ **@astrojs/cloudflare** 适配器，SSR 运行在 **Cloudflare Workers**
- **Cloudflare D1**：文集、文章、页面、版本历史、用户、评论、设置、登录限流等全部数据
- **Cloudflare R2**：上传图片与评论/头像附件
- **Vue 3 + Vite**：`admin/` 管理端 SPA，构建后合并进 Worker 静态资源（`dist/client/admin`）
- **marked + sanitize-html**：Markdown 渲染与 XSS 清洗
- **KaTeX**：数学公式服务端渲染；**Mermaid / MarkMap (d3)** 客户端运行时按需渲染
- **highlight.js**：代码语法高亮
- **TipTap (ProseMirror)**：WYSIWYG 编辑器（表格、代码块低亮）；**CodeMirror 6**：源码模式编辑器
- **OpenAI-compatible API**：AI 摘要生成（DeepSeek / OpenAI / 自定义端点）
- **nodemailer**：SMTP 邮件发送；兼容 Resend / Mailgun / SMTP2Go 等 HTTP API 邮件服务
- **Workers Cache API**：公开页面边缘缓存；**cron 触发器**：定时刊发到期文章
- **miniflare + node:test**：本地 e2e 测试

## 目录结构

```
admin/                    Vue 3 管理端 SPA（/admin/ 基路径）
  src/views/              Login / Dashboard / Collections / Posts / Editor / Import / Export / Media /
                          Pages / Comments / Users / Stats / Settings
  src/components/         VersionPanel（版本对比）、MediaPickerModal、TagChips
  src/lib/                drafts（草稿自动保存）、editor、format、import 解析
  src/store/auth.ts       登录态
db/
  migrations/             0001_init ~ 0032_email_http_api（D1 迁移）
  seed.sql                本地演示种子数据
  reset-local.sql         本地整库重置（cf:db:local 可重入）
scripts/
  cf-config.mjs           由模板 + .env 生成本地 wrangler.jsonc
  copy-vendor-css.mjs     把 KaTeX/hljs 样式复制到 public/_assets
  merge-admin.mjs         把 admin/dist 合并进 dist/client/admin
  build-worker.mjs        生成 scheduled-worker.mjs 包装入口（承接 cron）
  deploy.mjs              一键部署：构建 → 远程迁移 → 部署
  setup-deploy.mjs        从零部署向导（断点续传）
  theme.mjs               查看/切换主题
  theme-pack.mjs          打包主题 zip 并自检
  theme-add.mjs           安装主题（官方/本地 zip/URL/git）
  theme-update.mjs        升级/回滚已安装主题
  lib/                    official-zip.mjs、theme-validate.mjs
src/
  pages/                  路由：页面壳只查数据并把 SiteContext 传给主题模板
  lib/                    db/（D1 访问，按域拆模块）、api/、ai.ts（AI 适配层）、
                          ai-credentials.ts（AES-256-GCM）、email.ts、markdown.ts、
                          theme-context.ts（SiteContext 契约）、auth.ts、ratelimit.ts 等
  core/                   跨主题共享件：SiteHead.astro（CSP/canonical/og 封装）、utils、i18n
  themes/                 主题目录：modern（默认）/ classic（入库）；
                          用户安装的主题不入库（.gitignore 只放行这两套），
                          每套含 layouts/templates/components/styles/i18n
tests/                    node:test 单测 + e2e（按域拆分）
worker/                   worker.ts 自定义 Worker 入口（包装 Astro 入口并承接 scheduled 事件）
wrangler.jsonc.template   Workers 配置模板（占位符，可提交）
.env.example              真实资源 ID 的填法示例
```

## 主题系统

站点外观由 `src/themes/<slug>/` 整体定义——每个页面类型一个模板组件（home/collection/post/archive/tag-index/tag-detail/search/standalone/not-found + 可选认证页），页面壳只负责查数据并把上下文传进来：

```
src/pages/posts/[slug].astro   # 数据查询 + 守卫
  └─ <PostTemplate ctx={siteCtx} ... />   # @theme/templates/post.astro
```

**切换**：`pnpm theme` 查看；`pnpm theme <slug>` 切换（写 `.env` 的 `BLOG_THEME` 并同步 tsconfig），本地 `pnpm dev` 预览、`pnpm deploy` 上线。未设置时默认 `modern`。

**获取第三方主题**（官方主题仓库：[`themes_for_blog`](https://github.com/WhiteMoon319/themes_for_blog)）：

```bash
pnpm theme:add <slug>             # 从官方仓库安装（经人工审核；下载走 raw→api→git 多通道回退）
pnpm theme:add ./x.zip            # 直装本地 zip
pnpm theme:add https://.../x.zip  # 远程 zip
pnpm theme:add <git-url>          # git 仓库
pnpm theme:update <slug>[@version]  # 升级 / 按版本回滚
pnpm theme <slug>                 # 安装后切换
```

**新建主题三步**：

1. 复制任一现有主题（如 `classic`）为 `src/themes/<slug>/`，改 `theme.json` 的 name/slug；若需要起步模板可从官方仓库 `theme:add starter` 获取；
2. 改样式与模板——缺失的文件自动回退 `classic`（文件级继承），可只覆盖想改的部分；
3. `pnpm theme:pack src/themes/<slug>` 自检打包 → 提交 [PR 投稿](https://github.com/WhiteMoon319/themes_for_blog/blob/main/docs/CONTRIBUTING.md)。

**约束契约**：模板内禁止访问 DB/env（一切经 props 的 `SiteContext`），安全头/CSP 由核心 `<SiteHead>` 统一封装；纯函数（postHref/fmtDate 等）从 `@core/utils` 引用。完整契约见官方主题仓库的 [`THEME_DEVELOPMENT.md`](https://github.com/WhiteMoon319/themes_for_blog/blob/main/docs/THEME_DEVELOPMENT.md)。

### 站点文案与语言

后台「设置 → 站点信息」可直接修改界面语言（zh-CN / en）与文案变量：默认描述 `site_tagline`、页脚文案 `footer_line`、搜索框占位 `search_placeholder`、首页题记 `hero_note`。回退链：settings 表 → 环境变量（同名大写键）→ 内置默认。界面词汇归各主题自带词典（`themes/<slug>/i18n.ts`）。

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页：文集与最新文章 |
| `/collections/{collectionSlug}/` | 文集页 |
| `/collections/{collectionSlug}/{postSlug}/` | 文章页（有文集的文章） |
| `/posts/{postSlug}/` | 文章页（无文集的文章；有文集的旧路径访问自动 301） |
| `/pages/{slug}/` | 独立页面 |
| `/archive/`、`/about/` | 归档、关于 |
| `/search/?q=` | 站内搜索；`#标签` 开头转跳标签页 |
| `/tags/` | 标签云 |
| `/tags/{tag}/`；`/tags/?t=` | 独立标签页；多 `t` 取交集，`q` 为标签内关键词 |
| `/feed.xml`、`/sitemap.xml` | RSS 与站点地图（动态生成） |
| `/login/`、`/register/`、`/verify-email/`、`/account/` | 登录、注册、邮箱验证、个人中心 |
| `/preview/{id}/` | 草稿预览（需登录，`noindex`） |
| `/admin/...` | 管理端 SPA |

### API

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 登录 | 公开 |
| POST | `/api/auth/register` | 注册（邮箱验证码） | 公开 |
| POST | `/api/auth/verify-email` | 邮箱验证 | 公开 |
| POST | `/api/auth/resend-verification` | 重发验证码 | 登录 |
| POST | `/api/auth/logout`，GET `/api/auth/me` | 注销 / 校验会话 | 登录 |
| POST | `/api/auth/password` | 修改密码 | 登录 |
| GET/PUT | `/api/account`，POST `/api/account/password`，POST `/api/account/avatar` | 个人中心 | 登录 |
| GET/POST | `/api/collections`，GET/PUT/DELETE `/api/collections/{id}` | 文集 CRUD | 写需登录 |
| GET/POST | `/api/posts`，GET/PUT/DELETE `/api/posts/{id}` | 文章 CRUD（PUT 带 `base_version` 乐观锁） | 写需登录 |
| POST | `/api/posts/batch` | 批量创建/刊发/转草稿/移动/删除 | 登录 |
| GET/POST | `/api/posts/{id}/versions`，GET/POST `.../{version}/restore` | 版本历史与回滚 | 登录 |
| GET | `/api/tags` | 标签云计数 | 公开 |
| POST | `/api/upload` | 图片上传 → R2 | 登录 |
| GET/DELETE | `/api/media` | 媒体库 | 登录 |
| GET | `/api/files/[...key]` | R2 图片回源 | 公开 |
| GET/PUT | `/api/settings` | 站点设置 + AI 配置 | 登录 |
| POST | `/api/settings/email` | 邮件配置测试/保存 | 登录 |
| DELETE | `/api/settings/ai-key` | 清除 API Key | 登录 |
| GET/POST | `/api/pages`，GET/PUT/DELETE `/api/pages/{id}` | 独立页面 CRUD | 写需登录 |
| POST | `/api/render` | 源码模式预览渲染（Markdown → HTML） | 登录 |
| GET | `/api/stats`，`/api/stats/corpus` | 阅读趋势与字数统计 | 登录 |
| POST | `/api/ai/summary` | 单篇 AI 摘要生成 | 登录 |
| GET | `/api/ai/models` | 获取模型列表 | 登录 |
| POST | `/api/ai/test` | 测试并保存 AI 配置 | 登录 |
| POST | `/api/ai/batch-summary` | 批量 AI 摘要生成 | 登录 |
| GET/POST | `/api/comments`，DELETE `/api/comments/{id}`，POST `.../{id}/like` | 评论发布/审核/点赞 | 写需登录 |
| POST | `/api/comments/upload` | 评论图片附件 → R2 | 登录 |
| GET/POST | `/api/users`，POST `/api/users/{id}/ban` | 用户列表与封禁 | 登录 |
| POST | `/api/posts/{id}/like` | 文章点赞 | 公开 |
| GET | `/api/export`，`/api/export/posts/{id}.md` | 数据导出 | 登录 |
| GET | `/api/admin/comments`，`/api/admin/comments/{id}` | 评论审核管理 | 登录 |

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
| cron | `*/5 * * * *` | 定时刊发到期文章 |

## 构建与测试

```bash
pnpm run build          # cf-config → vendor css → admin 构建 → astro build → 合并 → worker 包装
pnpm run typecheck      # astro check + vue-tsc + tsc（含 worker/tests）
pnpm test               # 单测 + e2e（需先 pnpm run build）
```

## 部署（从零开始）

### 前置要求

- **Node.js ≥ 22**（自动检测，缺失时脚本会引导安装）
- **pnpm**（自动检测，缺失时脚本会用 npm 安装）
- **Cloudflare 账号**（免费即可）
- 一个已经指向 Cloudflare 的域名（可选，也可用默认的 `.workers.dev` 域名）

### 一键部署

```bash
# 1. 克隆仓库，进入目录
git clone https://github.com/WhiteMoon319/blog_for_WhiteMoon319.git
cd blog_for_WhiteMoon319
```

**然后二选一：**

**Windows**：双击 `setup.bat`（自动检查/安装 Node.js 与 pnpm，随后启动部署向导）

**macOS / Linux**：
```bash
chmod +x setup.sh
./setup.sh
```

> 若你已经装好 Node.js 和 pnpm，也可以直接用 `pnpm run setup` 启动同一个向导。

向导会逐步引导你完成以下操作（全程中文，支持断点续传）：

1. ✅ 检查 Node.js / pnpm
2. ✅ 安装依赖
3. ✅ 登录 Cloudflare（浏览器打开授权页面）
4. ✅ 自动创建 D1 数据库（blog-db）
5. ✅ 自动创建 R2 存储桶（blog-images）
6. ✅ 生成 `.env` 配置文件
7. ✅ 设置生产密钥（管理员密码、会话密钥、AI 加密密钥、SMTP 凭据等）
8. ✅ 应用数据库迁移
9. ✅ 构建并部署到 Cloudflare Workers

部署完成后，用浏览器访问你的域名即可看到博客。

### 首次部署后

登录后台 `/admin/`（管理员账号为 `admin`，密码为刚才设置的 `BLOG_ADMIN_PASSWORD`）：

1. **设置 → 邮件**：填入 SMTP（如 `smtp.qq.com`、端口 `465`、QQ 邮箱、授权码）或 HTTP API（Resend / Mailgun / SMTP2Go）凭据，「测试并保存」——注册验证码和回复通知邮件才能发送
2. **设置 → AI 摘要**：如需 AI 摘要功能，配置服务商 / API Key / 模型
3. **设置 → 评论设置**：配置需人工审核的关键词（若不配置则全部直接展示）

### 手动部署

如需一步步手动操作：

```bash
# 1. 修改站点名称为你的博客名（可选）
# 编辑 wrangler.jsonc.template 中的 vars 部分

# 2. 安装依赖
pnpm install

# 3. 登录 Cloudflare
pnpm exec wrangler login

# 4. 创建 D1 数据库（获取 database_id）
pnpm exec wrangler d1 create blog-db

# 5. 创建 R2 存储桶
pnpm exec wrangler r2 bucket create blog-images

# 6. 复制 .env.example 为 .env，填入真实 D1 数据库 ID
cp .env.example .env

# 7. 设置生产密钥（逐个输入）
npx wrangler secret put BLOG_ADMIN_PASSWORD
npx wrangler secret put BLOG_SESSION_SECRET
npx wrangler secret put AI_SETTINGS_ENCRYPTION_KEY   # 32 字节 hex，用 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 生成
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASS
npx wrangler secret put SMTP_FROM

# 8. 应用远程迁移 + 种子
npx wrangler d1 migrations apply blog-db --remote
npx wrangler d1 execute blog-db --remote --file=db/seed.sql   # 可选：演示种子数据

# 9. 构建并部署
pnpm run build
npx wrangler deploy
```

### 日常更新

```bash
pnpm run deploy    # 构建 → 迁移 → 部署（一键）
```

## 性能优化

| 优化 | 效果 |
|------|------|
| 边缘缓存 | Workers Cache API 匿名公开页面 60s 边缘命中，登录用户 no-store |
| 按需渲染 | KaTeX 样式、hljs 样式、mermaid/markmap 运行时仅在正文含对应内容时加载 |
| 编辑器懒加载 | 编辑器相关重资源动态 chunk，避免首屏阻塞 |
| 公开页面 | 首页仅 1 个 CSS，0 个 JS，首次加载无 JS 阻塞 |
| D1 查询优化 | 点赞计数批量计算、sitemap 列裁剪 |

## 数据库

- **迁移**：`db/migrations/0001_init` ~ `0032_email_http_api`（共 32 个）
- **核心表**：`collections`（文集，含 `ref_summaries`/`ai_prompt_id`）、`posts`（文章，含 `summary_source`/`view_count`/`is_pinned`/`scheduled_at`）、`post_versions`（增量版本）、`pages`（独立页面）、`tags`/`post_tags`/`collection_tags`、`collection_deletes`（删文集分批迁移账本）、`login_attempts`、`posts_fts`（FTS 全文检索）、`ai_credentials`（AES-256-GCM 加密 API Key）、`settings`（站点与 AI 配置，含 `ai_prompt_templates`）、`users`/`comments`/`comment_likes`/`post_likes`/`email_verifications`、`email_credentials`（SMTP 或 HTTP API 凭据）、`daily_views`（阅读统计）
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