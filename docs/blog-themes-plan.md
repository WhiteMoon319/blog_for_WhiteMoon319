# 主题分发链路建设计划（themes_for_blog 仓库 + 主仓三命令）
> 更新时间：2026-08-26
>
> 目标：落地 `docs/theme-switcher-plan.md` §7 的分发生态——建成官方主题仓库 **`WhiteMoon319/themes_for_blog`**（每主题一文件夹 = zip + README + shots），主仓库补齐 `theme:pack / theme:add / theme:update` 三命令，同一份校验代码在打包/安装/CI 三处复用，人工审核流程文档化。
>
> 前提：主分支已完成主题系统（@theme 解析器、classic/modern 双主题、纯净层契约、theme.json 规范）。

---

## 1. 总览

```
作者侧                         官方仓库(blog-themes)                使用者侧
──────                        ─────────────────────               ─────────
本地开发(复制进主仓调试)        <slug>/                             pnpm theme:add <slug>
  ↓ pnpm theme:pack             ├─ <slug>.zip   ← CI 预审 ──┐          │ 校验→解压→src/themes/
  ↓ 自检报告                    ├─ README.md               │      pnpm theme <slug>
  └─ PR(zip+README+一览行) ──→ └─ shots/                  │      （人工复审后合入=上架）
                                                          └─ 也可直装任意 zip/git-url(风险自担)
```

**核心原则**：审核对象 = 分发对象 = 安装对象，同一个 zip 工件，无形态转换；合入与否始终由人工决定，CI 只降成本。

## 2. 主仓库侧：共享校验器 + 三命令

### 2.1 共享校验器 `scripts/lib/theme-validate.mjs`（一切的地基）

单一模块，双形态可用（import 函数 / 直接当 CLI 执行），供 pack·add·CI 三处复用：

```js
// 导出
HARD_LIMITS                     // 常量集中定义
validateThemeDir(dir)           // 目录形态：theme.json Schema(slug 正则/engine_version/BaseLayout/必需模板)
validateZipBuffer(buf)          // zip 形态：§7.0 全部硬限制 → { ok, errors[], warnings[], manifest }
scanImports(filesMap)           // 敏感导入扫描（静态 import/export-from + 动态 import('…') 字符串）
// CLI 入口（供 CI 跨仓调用）
node theme-validate.mjs check-zip <file.zip>
node theme-validate.mjs check-dir <dir>
```

**硬限制**（定稿数值）：zip ≤ 10MB、条目 ≤ 200、单文件 ≤ 512KB、扩展名白名单 `.astro/.ts/.json/.css/.png/.jpg/.svg/.woff/.woff2/.md`（刻意排除 js 系防夹带编译产物）、解压路径规范化禁 `..`/盘符、压缩比 > 20 判炸弹、slug `^[a-z0-9][a-z0-9-]{1,30}$` 且 ∈ 保留字拒绝（classic/modern）。

**敏感导入扫描规则**：逐文件正则匹配 `(import|from)\s*['"]([^'"]+)` 与 `import\(\s*['"]([^'"]+)`：
- 拒绝：含 `lib/db`、`lib/auth`、`astro:env`、`node:`、`cloudflare:`、`~/*` 指向主题外
- 允许：`@core/*`、`@theme/*`、相对路径（限主题目录内）、`astro:` 公开 API

**zip 编解码依赖**：新增 devDependency **`fflate`**（约 30KB、零依赖、读写双向、无 native 绑定）。不用系统 zip 命令（跨平台不可靠）。

### 2.2 `pnpm theme:pack <目录>`（作者侧出口）

1. `validateThemeDir` 全量自检 → 失败列出问题退出；
2. 以 slug 为顶层目录写 zip → 输出到 `dist/themes/<slug>.zip`（已被 gitignore 覆盖）；
3. `validateZipBuffer` 回读自检 → 输出报告（大小/条目数/词表 key 数/引擎契约版本），附下一步指引（投稿 PR 三件套说明）。

### 2.3 `pnpm theme:add <来源>`（使用者入口）

| 来源形态 | 处理 |
|---|---|
| `<slug>` | 官方源 `.env THEMES_REPO`（默认 `WhiteMoon319/themes_for_blog`）：GET `raw.githubusercontent.com/<repo>/main/<slug>/<slug>.zip` |
| `./a.zip` / 绝对路径 | 本地文件 |
| `https://….zip` | 远程直装，**打印「未经官方审核」风险提示** |
| git URL | 浅克隆到临时目录；根有 theme.json 用根，否则取唯一包含它的子目录 |

统一后续管线：`validateZipBuffer` → `scanImports` → 解压至 `src/themes/<slug>/`。
冲突策略：目标存在需 `--force`；slug 为保留字（classic/modern）时无条件拒绝，`--force` 不豁免。
完成后输出：`pnpm theme <slug>` 切换提示 + 「该主题源码已被 gitignore，不会进入主仓历史」说明。

### 2.4 `pnpm theme:update <slug>[@version]`

重拉官方源同管线覆盖；`@version` 走 blog-themes 的 git tag（约定 tag 名 `<slug>-v<semver>`，如 `tsukimiso-v1.2.0`）→ `raw…/refs/tags/<tag>/<slug>/<slug>.zip`。输出当前已装版本与目标版本的 changelog 链接（指向主题文件夹 README 的更新日志小节）。

## 3. themes_for_blog 仓库脚手架

```
blog-themes/
├─ README.md            # 一览表：|- [slug](./slug/) | 一句话 | engine_version |；文首投稿入口
├─ CONTRIBUTING.md      # 投稿指南（见 §5）
├─ starter/             # 示范主题：由 classic 复制改名（classic 是保留字不入市场）
│  ├─ starter.zip / README.md / shots/home.png
├─ .github/workflows/ci.yml
└─ .github/pull_request_template.md   # 勾选清单：version 已递增 / 截图真实 / AGPL 兼容 / 一览表已加行
```

### CI 工作流（PR 触碰 `*/` 下内容即跑）

| 步骤 | 实现 |
|---|---|
| 1. 定位变更主题 | `git diff --name-only origin/main...` 归纳出 `<slug>/` 集合 |
| 2. 取校验器 | 浅克隆主博客仓库到 `_blog/`（ref 由仓库变量 `BLOG_ENGINE_REF` pin）→ `node _blog/scripts/lib/theme-validate.mjs check-zip …` |
| 3. 结构校验 | 文件夹名=zip 名=manifest.slug；README 必需小节（截图/安装/许可/更新日志）；根 README 一览表含该 slug 行 |
| 4. 构建冒烟 | `_blog` 内 `pnpm install` → 解压 zip 至 `src/themes/<slug>` → `BLOG_THEME=<slug> pnpm run build` 必须成功 |
| 5. 版本递增 | 若 main 已存在同名 zip：比对新旧 theme.json.version，非递增即 fail |
| 6. 审阅产物 | 上传 artifact：解包树 + `git diff --no-index` 上一版语义 diff（解决 zip 黑盒不可 diff 问题） |
| 7. 契约核对 | manifest.engine_version ≠ pin 版契约 → PR 评论警告（不阻断，人工判断） |

## 4. 需要决策的两个点（实施前确认）

1. **官方源地址**：默认按 `WhiteMoon319/themes_for_blog` 写死为 fallback 常量，`.env THEMES_REPO` 可覆盖——仓库名若不同请告知。
2. **境内可达性**：raw.githubusercontent.com 境内可能不稳定。v1 不做镜像，文档注明「可用 `theme:add ./x.zip` 替代」；后续如有需要再加 CDN 环境变量。

## 5. CONTRIBUTING.md 内容清单（投稿指南）

- 开发方式：克隆主博客仓库 → 主题目录复制或 mklink 进 `src/themes/<slug>/` → `BLOG_THEME=<slug> pnpm dev`
- 打包：`pnpm theme:pack <目录>`，报告全绿再投稿
- PR 三件套：新建 `<slug>/`（zip + README[截图/特性/安装/许可证/更新日志] + shots/）＋ 根 README 一览表加一行
- 审核标准（对审核者也公开）：契约完整性 / 敏感导入为零 / 无混淆压缩代码 / AGPL-3.0-or-later 或兼容 / 截图真实 / CI 冒烟绿
- 版本与兼容：semver；engine_version 兼容矩阵随主仓发版更新

## 6. 实施里程碑（合计 ≈ 1.5 天）

| 里程碑 | 内容 | 估时 |
|---|---|---|
| M1 | fflate 依赖 + theme-validate.mjs（函数 + CLI 入口）+ theme:pack | 0.5 天 |
| M2 | theme:add / theme:update（下载/解压/落盘/保留字与冲突策略） | 0.5 天 |
| M3 | blog-themes 脚手架 + starter 示范主题 | 0.25 天 |
| M4 | CI 工作流 + 彩排：自己 fork 提一个真实 PR 走完全链路 | 0.25 天 |

## 7. 验收清单

- [ ] `starter` 主题走通全链路：pack → 手动入仓 → PR CI 绿 → 合入 → `theme:add starter` → `pnpm theme starter` 切换构建成功
- [ ] `theme:add classic` / `modern` 被拒（保留字）；`--force` 亦拒
- [ ] 恶意样本全部拦截：路径穿越 zip、超 10MB zip、夹带 `.js`、压缩比异常、import lib/db 的主题
- [ ] 更新场景：改 starter 内容 version 1.0.1 → PR → CI 版本递增检查通过 → `theme:update starter` 升级成功、`@1.0.0` 回滚成功
- [ ] CI artifact 含解包树与上一版语义 diff
- [ ] 主仓 `pnpm typecheck / test(211) / build` 保持全绿（新命令不触碰渲染链路）
