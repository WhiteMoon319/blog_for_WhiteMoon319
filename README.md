# 月下独酌 · blog

架在 Cloudflare 上的个人博客：前台访客展卷，后台主人落笔。文章以 Markdown 写就，可分文集（合集），支持发布/草稿切换、版本历史、图片直传、AI 摘要生成、用户注册与评论互动。

## 功能

**前台**

- 首页：文集入口 + 最新文章
- 文集页 / 文章页：按文集组织文章；已收入文集的旧路径 `/posts/{slug}/` 永久 301 转跳文集路径，未收录则 404
- 标签：标签云、独立标签页 `/tags/{tag}/`、`/tags/?t=` 多标签交集检索、标签内关键词搜索
- 归档页（按时间轴）、关于页、站内搜索（`/search/`，`#标签` 前缀自动转跳标签页）
- 阅读量统计、上一篇/下一篇相邻导航、`/sitemap.xml` 动态生成
- KaTeX 数学公式、Mermaid 流程图、MarkMap 脑图服务端渲染 + 客户端运行时（按需加载：正文含对应内容才拉取资源）
- 代码高亮（highlight.js）、GFM 表格
- 用户系统：注册（邮箱验证码验证）/ 登录（用户名或邮箱）/ 个人中心（昵称、头像、密码、邮箱绑定、邮件提醒开关）
- 评论系统：嵌套回复（2 层）、楼层号（`1_1` 格式）、文字 + 图片（R2 附件）、点赞、敏感词人工审核
- 文章/评论点赞
- 边缘缓存：Workers Cache API 匿名公开页面 60s 边缘缓存 + 后台刷新
- 古风水墨视觉风格：纸纹背景、印章、毛笔标题、朱砂强调色、深色模式

**后台（`/admin`）**

- 统一账号登录（与管理端共用 `/login`，role 判定权限；非管理员访问后台跳 404）
- 文集管理：新建/编辑/删除（名称、slug、简介、主题色、参考前文摘要开关、AI 摘要模板选择）
- 文章管理：Tiptap 富文本编辑器（可视化 + 源码双模式，CodeMirror Markdown 编辑 + 实时预览），表格/代码高亮/链接/图片，发布/草稿/定时/置顶
- AI 摘要生成：单篇生成（多候选可选）、批量生成（导入页/文章列表）、文集参考摘要、可配置 API Key（AES-256-GCM 加密存储）
- 版本历史：增量存储（unified diff），回滚，对比与词级高亮
- Word 文档（.docx）导入为 Markdown，导入后 AI 批量生成摘要
- 图片管理：拖拽直传 R2，媒体库浏览/删除，封面与正文插图
- 数据看板：阅读趋势、日聚合热文 TOP、统计字数
- 评论审核：待审/已准/已拒分栏、按文章 ID 筛选、批准/驳回/删除
- 用户管理：列表、封禁/解封（封禁即踢下线）

## 技术栈

- **Astro 7**（`output: server`）+ **@astrojs/cloudflare** 适配器，SSR 运行在 **Cloudflare Workers**
- **Cloudflare D1**：文集、文章、版本历史、用户、评论与登录限流数据
- **Cloudflare R2**：上传图片与评论/头像附件
- **Vue 3 + Vite**：`admin/` 管理端 SPA，构建后合并进 Worker 静态资源（`dist/client/admin`）
- **marked + sanitize-html**：Markdown 渲染与 XSS 清洗
- **KaTeX**：数学公式服务端渲染
- **Mermaid / MarkMap (d3)**：图表客户端运行时渲染（动态 import 按需加载）
- **highlight.js**：代码语法高亮
- **TipTap (ProseMirror)**：WYSIWYG 编辑器（表格、代码块低亮）
- **CodeMirror 6**：源码模式 Markdown 编辑器
- **OpenAI-compatible API**：AI 摘要生成（DeepSeek / OpenAI / 自定义端点）
- **nodemailer**：SMTP 邮件发送（注册验证码、回复通知）
- **Workers Cache API**：公开页面边缘缓存
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

## 部署（从零开始）

### 前置要求

- **Node.js ≥ 22** + **pnpm**（`npm install -g pnpm`）
- **Cloudflare 账号**（免费即可）
- 一个已经指向 Cloudflare 的域名（可选，也可用默认的 `.workers.dev` 域名）

### 一键部署

```bash
# 1. 克隆仓库，进入目录
cd blog_for_WhiteMoon319

# 2. 运行一键部署向导
pnpm run setup
```

向导会逐步引导你完成以下操作（全程中文）：

1. ✅ 检查 Node.js / pnpm
2. ✅ 安装依赖
3. ✅ 登录 Cloudflare（浏览器打开授权页面）
4. ✅ 自动创建 D1 数据库（blog-db）
5. ✅ 自动创建 R2 存储桶（blog-images）
6. ✅ 生成 `.env` 配置文件
7. ✅ 设置生产密钥（管理员密码、会话密钥、AI 加密密钥、SMTP 凭据等）
8. ✅ 应用数据库迁移
9. ✅ 构建并部署到 Cloudflare Workers

整个过程约 5-10 分钟。部署完成后，用浏览器访问你的域名即可看到博客。

### 首次部署后

部署完成后，登录后台 `/admin/`（管理员账号为 `admin`，密码为刚才设置的 `BLOG_ADMIN_PASSWORD`）：

1. **设置 → 邮件（SMTP）**：填入 `smtp.qq.com`、端口 `465`、QQ 邮箱、授权码，点「测试并保存」——注册验证码和回复通知邮件才能发送
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
| 编辑器懒加载 | PostEditorView 2.4MB → 1.2MB，mermaid/markmap 动态 chunk |
| RSS 内存缓存 | 代际 key 缓存，避免每次请求重渲染 50 篇 markdown |
| D1 查询优化 | 点赞计数改为 LEFT JOIN GROUP BY 批量计算，sitemap 列裁剪 |
| 公开页面 | 首页仅 1 个 CSS（45KB），0 个 JS，首次加载无 JS 阻塞 |

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