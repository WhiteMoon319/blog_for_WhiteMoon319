# 本地主题切换计划（构建期 · WordPress 级整页模板）
> 更新时间：2026-08-26（v3.1：经子代理代码核查与对抗式评审后定稿。关键变化：测试基线契约化、动态 tsconfig、SiteHead/AuthForm 核心组件、i18n 客户端机制、主题资源服务规则）
>
> 目标：仓库内多套完整主题，各自定义全站每个页面类型的排版与内容组织；本地一条命令切换、`pnpm dev` 预览、`pnpm deploy` 上线。首发双主题：现版纸墨风迁入 `classic`，新做简约现代 `modern` 为默认；站点文案可配置、核心 UI 支持 i18n。不做运行时上传/DB 切换（Tier 3 见 `docs/theme-system-plan.md`）。

---

## 0. 事实基线（经代码核查修正）

| 计划假设 | 核查结果 |
|---|---|
| 路由文件 | `src/pages` 共 **17 个 .astro**：内容面 11 个路由映射 8 类模板（post 有双路由、tag 有列表/详情两种异构数据）、认证/账号 5、preview 1；另有 ~55 个非 .astro 端点（api/feed/sitemap/admin）留核心 |
| 测试 | node:test，实际 **211 项**；`tests/ui.test.ts` 直接读 BaseLayout 源文件断言 CSP/Fonts——迁移即碎；多个 e2e 断言 classic 专属类名文案（`pinned`/「置于案头」等） |
| 数据访问现状 | BaseLayout 自查 envOf+resolveUser；TagResults 查 D1；**Comments 的 frontmatter 也动态 import lib/db 取 R2_PUBLIC_URL**（字符串形式动态导入，扫描器需覆盖） |
| 配置链 | `envOf()` 读 Workers bindings（非进程环境变量）；settings 表白名单已有 SITE_NAME/SLOGAN/POEM/URL，但**前台渲染从不读 settings 表**，全直读 env——回退链在渲染侧是从零接入 |
| 框架版本 | astro ^7.2.2 + @astrojs/cloudflare ^14；astro.config 无既有 vite/alias 配置；tsconfig 无 paths |
| 边缘缓存 | middleware 匿名 HTML 缓存 60s（仅按 URL），构建期换主题=重新部署，旧 HTML 最长残留 60s，可接受 |
| 反向依赖 | admin 与 worker 反向 import `src/lib/**`，20+ 测试依赖 lib API——**src/lib 必须原地不动** |

## 1. 选型结论

- **模板能力**向 WP 看齐：主题拥有每个路由的展示层。
- **切换方式**为构建期：混合预渲染烧产物、Workers 体积、零新依赖（论证见 git 历史 v1 版本）。
- **核心机制**「核心路由壳 + 主题模板组件」：路由与数据获取永属核心，模板是纯展示 Astro 组件接收 Context props——WP「Loop 在核心、模板消费数据」的同构实现。

## 2. 目录结构与契约

```
src/
├─ pages/                  # 核心路由壳（每页 ≈20 行）：查数据 → getSiteContext() → 渲染 @theme 模板
├─ lib/
│  ├─ …（现有模块原地不动，admin/worker 反向依赖）
│  ├─ theme-context.ts     # ★ 类型契约 + 语义钩子清单（data-testid 等）
│  └─ i18n.ts              # 字典 + t() + 客户端注入辅助
└─ themes/
   ├─ modern/              # ★ 默认主题：简约现代风（§2.0）
   ├─ classic/             # 现版纸墨风迁入；系统保护主题（§3）
   └─ <slug>/              # 第三方安装目标（gitignore，见 §3）
```

单个主题内部：

```
theme.json
templates/        home/collection/post/standalone/archive/tag-index/tag-detail/search/404（核心9个，软必需）
                  login/register/account/logout/verify-email（可选覆盖，行为归核心见下）
layouts/BaseLayout.astro（硬必需）
components/       ArticleEnhancer/Comments/Pagination/PostLike/TagResults（可选同名覆盖）
styles/           tokens.css/base.css（随 BaseLayout 引入）
scripts/          collection-anim.ts 等主题自有脚本（随组件走）
```

| 层 | 必需性 | 缺失行为 |
|---|---|---|
| BaseLayout + styles | ✅ 硬必需 | 拒绝激活 |
| 核心 9 模板 | ✅ 软必需 | 逐文件回退 classic，CLI 给警告清单 |
| 认证 5 模板 / components 5 个 | ⛔ 可选 | 同上回退 |

### 2.0 首发双主题

| slug | 定位 | 说明 |
|---|---|---|
| `modern` | ★ 默认（BLOG_THEME 未设时） | 中性色板（近黑/近白+单一强调色）、无衬线主导、大留白、细分隔线、去纸纹/印章装饰、轻阴影；深浅双模式保留 |
| `classic` | 现版存档 + 契约参照实现 + 分发链示范包 | 纸墨朱砂原样迁入；系统保护主题（§3） |

### 2.1 核心组件边界（评审新增）

- **`<SiteHead>`（核心所有）**：封装 CSP meta、canonical、og/twitter、noindex、RSS link、favicon——安全与 SEO 不变量永不离手；主题经 props/slots 定制 title/description/额外样式链接。跨主题 e2e 断言 CSP 与字体 link 作为不变量保留。
- **认证行为归核心**：login/register 的表单行为脚本（含 `safeRedirect` 防开放重定向）、错误码→文案映射由核心提供 island（或 data-contract + 注入字典）；主题只管结构与样式。`LoginContext/RegisterContext` 显式携带服务端净化后的 `redirect/errorCode` 字段。
- **主题静态资源**必须经 JS import 或 CSS `url()` 由 Vite emit（zip 白名单不含 `.js/.mjs/.cjs` 同理防夹带）；禁止以站内绝对路径引用主题自有资源（CI 结构校验项）。

### 2.2 数据纯净层

引入 `getSiteContext(Astro)`：返回 `{ site, user 摘要, nav, locale, t, copy }`，页面壳调用后 props 下传。迁移时转纯 props 的组件：**BaseLayout、TagResults、Comments**（Comments 的 R2_PUBLIC_URL 改经 context）。扫描规则随之严格化：主题目录仅允许 import `@theme/*`、`theme-context`（type-only）与 `astro:` 公共 API；扫描需覆盖**动态 import 字符串**。语义钩子（`data-testid`/i18n key 清单）随 theme-context.ts 冻结，供 e2e 与第三方主题对齐。

**theme.json 规范**：

```jsonc
{
  "name": "月见草",
  "slug": "tsukimiso",          // ^[a-z0-9][a-z0-9-]{1,30}$；classic/modern 为保留字
  "version": "1.0.0",
  "engine_version": "1",        // 对应 theme-context.ts 顶部声明的契约版本
  "author": "...",
  "license": "AGPL-3.0-or-later"
}
```

### 2.3 站点文案变量

页面文字经 `context.copy.*` 注入，主题不得硬编码：

| key | 内置默认（现硬编码处） | 用途 |
|---|---|---|
| `site_tagline` | 一座写在 Cloudflare 上的小书斋。（BaseLayout:17） | 默认 meta 描述/首页副题 |
| `footer_line` | 月下少辞令，醉后自逍遥。（BaseLayout:127，现 env SITE_POEM 同文） | 页脚文案行 |
| `search_placeholder` | 寻章……（BaseLayout:109） | 导航搜索框占位 |
| `hero_note` | （空） | 首页可选题记位 |

存储与回退链：settings 表「站点文案」组 → 同名 Workers 变量 → 内置默认（复用 `/api/settings` 既有的 `entries ?? env ?? defaults` 合并模式，新增键进白名单即可）。**优先级规则**：同 key 时 `copy.*` 覆盖 `t()` 默认值，且 copy 无 locale 维度——站长自配文案不随语言翻译属预期行为。

### 2.4 i18n（站点级，v3.2 定稿：词汇归主题、机制归核心）

- **机制层** `@core/i18n`（唯一合法主题导入路径）：`LOCALES/isLocale/makeT(locale, dicts)` 纯机制，零词典；lib/i18n 为其单源。
- **词典层归主题**：各主题在自身目录维护字典并导出 t 工厂（如 `themes/classic/i18n.ts` 的 `classicT(locale)`）；第三方主题同理自带词汇——与 WP 主题 text-domain 模型同构。
- **契约**：SiteContext 仅携带 `locale` 与路由键 `nav: [{key, href}]`（home/archive/tags/search/about），不预置任何语言文案；主题按 key 自行取词。核心组件（SiteHead）所需个别词条由调用方翻译后经 props 传入（如 rssTitle）。
- **客户端字符串**：标准模式 = 服务端将所需 key 序列化为 `data-i18n` 属性或 `define:vars` JSON island + 核心轻量查表运行时；纳入 engine_version="1" 契约。
- **范围**：站点 locale 由 settings 驱动（v1 仅站点级）；日期经 `Intl.DateTimeFormat(locale)`。首发 zh-CN 完整、en 覆盖 classic 全部 chrome 词表；第三方主题不承诺翻译。

## 3. 解析、切换与类型检查（评审修订）

- Vite 插件（`enforce: 'pre'`）解析 `@theme/*`，**resolveId 只返回真实物理路径**（保 HMR）；解析顺序 = 激活主题 → `classic`（系统保护主题：CLI 禁删禁改名，`use` 时附带校验其完整性）→ 报错。dev 中途补入此前缺失的覆盖文件需重启 dev server（CLI 输出提示）。
- **动态 tsconfig**（替换原「paths 恒指 classic」方案）：`theme.mjs use` 时生成片段供 extends——paths 按序 `["@theme/*": ["src/themes/<active>/*", "src/themes/classic/*"]]`；include 仅纳 `<active>+classic`（避免第三方/半成品主题打红主仓 astro check）。切主题后 VSCode 需 reload TS server（文档注明）。
- `src/themes/*` 默认加入 `.gitignore` 并显式反忽略 `classic/modern`——第三方主题源码不落主仓历史。
- `BLOG_THEME` 未设 → `modern`。

## 4. 实施步骤

1. **迁移外壳**：`git mv src/{layouts,components,styles}` → `themes/classic/`；修相对层级；`collection-anim.ts` 随 TagResults 迁为主题脚本。
2. **纯净层 + 文案 + i18n 基建**：getSiteContext/theme-context（含语义钩子清单）/i18n（含客户端运行时）/SiteHead/认证 island；BaseLayout·TagResults·Comments 转纯 props；settings 白名单加文案键与 locale，设置页加编辑区块。
3. **拆分页面**：17 路由 → 14 模板文件（内容面 11 路由 → 9 核心模板，tag 拆 index/detail 双变体、post 承接双路由与 preview 复用；认证 5 → 可选模板）。
4. **测试基线契约化**：ui.test.ts 改断言渲染产物或激活主题布局；e2e 改断言语义钩子与数据语义，剥离 classic 装饰性类名/文案断言（`pinned`/「置于案头」等迁入 classic 专属用例或钩子化）。
5. **classic 视觉回归确认**（此时与现版等价）。
6. **modern 主题实现**：13+ 模板全新设计，chrome 文案全量 t()。
7. **解析器与 CLI**：插件、动态 tsconfig、theme.mjs、package.json scripts。
8. **文档**：README 主题开发/文案变量/i18n 章节；本计划随代码提交。

## 5. 验证清单

- [ ] `pnpm typecheck` / `pnpm test`（211 项）/ `pnpm run build` 全绿
- [ ] 纯净层 grep：themes/ 下无 `lib/db`、`lib/auth`、`astro:env` 导入（含动态 import 形式；classic 自身通过）
- [ ] 跨主题不变量：CSP meta、字体 link、canonical 在 classic/modern 下均成立（e2e）
- [ ] classic 结构回归：关键页去哈希 DOM diff + 视觉冒烟（scoped style 哈希必变，「逐字节等价」不可行）
- [ ] BLOG_THEME 不设 → modern；设 classic → 回归通过；设不存在 → 明确报错
- [ ] 冒烟 A：test 主题重写 home.astro 生效；冒烟 B：只带 BaseLayout+2 模板 → CLI 警告回退清单正确
- [ ] 每主题交互冒烟一轮：评论发布/点赞/分页/移动端菜单（验证组件↔模板选择器耦合）
- [ ] 文案变量：改 footer_line/site_tagline 下次渲染生效；清空回落链逐级验证
- [ ] i18n：locale=en 导航/按钮/表单/评论 UI/客户端错误提示全英文；grep 无遗漏硬编码中文
- [ ] theme:add 对 slug=classic/modern 拒绝（--force 亦不可）
- [ ] e2e 全量冒烟（登录/发文/评论/点赞/预览）

## 6. 边界与非目标

- 页面路由、URL 结构、数据语义不入主题。
- feed/sitemap/api/middleware/admin 后台界面不受影响；feed/sitemap 接入同一文案回退链避免站名分叉。
- i18n v1 仅站点级；per-user 偏好、URL 语言前缀、RTL 不做。
- 第三方主题不保证多语言；文章正文永属数据。
- Customizer 归 Tier 3。

## 7. 第三方分发（独立主题仓库 · zip 交换 · PR 投稿 · 人工审核）

### 7.0 交换格式：zip（唯一正式形态）

```
my-theme.zip └ my-theme/（顶层目录名=slug，允许双层兼容）
                theme.json / templates/ layouts/ components/ styles/ scripts/ README.md
```

硬限制（theme:add 与 CI 双侧同一份校验代码）：zip ≤10MB、条目 ≤200、单文件 ≤512KB、扩展名白名单 `.astro/.ts/.json/.css/.png/.jpg/.svg/.woff/.woff2/.md`（刻意排除 js 系防夹带编译产物）、路径规范化禁 `..`/绝对路径、压缩比 >20 判炸弹、slug 正则与保留字校验。

### 7.1 仓库结构（每主题一文件夹 = zip + README）

```
blog-themes/
├─ README.md            # 投稿指南 + 主题一览表
├─ tsukimiso/
│  ├─ tsukimiso.zip     # 工件（审完即所装；更新=PR 替换并递增 version）
│  ├─ README.md         # 截图/特性/契约版本/安装方法/更新日志/许可证
│  └─ shots/
└─ .github/workflows/ci.yml
```

GitHub 渲染各 README 即天然展示页。审核对象=分发对象，无形态转换。

### 7.2 三方工作流

- **作者**：本地按契约开发 → 复制/mklink 进主仓 `src/themes/<slug>/` 以 `BLOG_THEME=<slug> pnpm dev` 调试 → `pnpm theme:pack <目录>` 打包自检 → fork blog-themes 提 PR（`<slug>/` 文件夹 + 根 README 一览表加行）。
- **站长**：CI 自动预审 zip 工件 + 人工复审（契约完整性/敏感导入为零/无混淆代码/许可证兼容/截图真实）后合入。
- **使用者**：
  ```
  pnpm theme:add <slug>      # 官方源下载 <slug>/<slug>.zip → 校验 → 解压至 src/themes/
  pnpm theme:add ./a.zip     # 本地 zip（同一套校验）
  pnpm theme:add <zip-url>   # 远程 zip（提示未经官方审核）
  pnpm theme:add <git-url>   # git 仓库（取根；无 theme.json 则取唯一含它的顶层目录）
  pnpm theme:update <slug>[@version]   # 重拉；支持版本选择与回滚
  ```
  slug 为保留字（classic/modern 及本地已跟踪主题目录）时拒绝，`--force` 不豁免；目标已存在需 `--force`。

### 7.3 主题仓库 CI（自动预审）

| 检查 | 实现 |
|---|---|
| 目录规范 | 文件夹=zip 名=slug 三者一致；README 必需小节齐全 |
| 结构校验 | theme.json Schema、必需文件、主题资源引用方式合规（禁站内绝对路径引自身资源） |
| 敏感导入扫描 | 静态+动态 import 扫描，规则与主仓共用 |
| 构建冒烟 | pin 主仓 ref → 解压注入 → build 必须成功 |
| 解包审阅产物 | 产出解包树 + 与上一版的语义 diff 为 artifact，供人工复审 zip 黑盒问题 |
| 契约版本核对 | engine_version 与 pin 的博客比对，不符标警告 |

合入与否始终人工决定。版本按 theme.json version 打 git tag。

### 7.4 安全边界

主题=编译进 Worker 的代码而非沙箱数据。护栏：人工审核 + 敏感导入扫描 + 来源单一 + SiteHead 保底安全头不变量。直装外部来源输出风险提示。真正沙箱化属 Tier 3（Liquid 数据化）。

## 8. 估时

| 项 | 估时 |
|---|---|
| 迁移 classic + 纯净层 + 拆分 + 契约（步骤 1–3） | 1.5–2 天 |
| 测试基线契约化（步骤 4） | +0.5–1 天 |
| 文案变量全链路 | +0.5 天 |
| i18n（设施+客户端机制+官方主题 chrome 全量化+en 翻译） | +1–1.5 天 |
| modern 新主题（13+ 模板双模式） | +1–1.5 天 |
| 解析器/动态 tsconfig/CLI | +0.25 天 |
| **主体合计** | **≈ 5.25–7.25 天** |
| theme:add/update/pack + 扫描 + SiteHead/认证 island 收尾 | +0.5–1 天 |
| blog-themes 脚手架（README/指南/CI） | +0.5 天 |

后续新增主题约半天起；classic 作为首个示范包走通投稿链路。
