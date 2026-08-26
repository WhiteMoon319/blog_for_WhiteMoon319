# 主题系统计划（Tier 3 · WP 级可安装主题）
> 更新时间：2026-08-26
>
> 目标：为博客提供 **WordPress 级主题系统**——第三方可打包上传的整站外观包，支持后台上传/预览/启用、子主题继承、可视化定制（Customizer），并保持现有功能组件（评论/点赞/AI 摘要）跨主题可用。
>
> 定位声明：这是三个层级中成本最高的一档。本计划如实列出技术约束与代价，实施前建议先完成 Tier 1（皮肤系统）作为过渡。

---

## 0. 核心架构决策：为什么是「运行时模板引擎」而不是「上传 Astro 组件」

WordPress 的主题之所以可行，是因为 PHP 是**运行时解释**的：上传的 `.php` 文件由服务器即时执行。而本项目基于 Astro——模板在**构建期编译**成 JS，没有运行时模板层。由此有两条路：

| 方案 | 做法 | 结论 |
|---|---|---|
| A. 重构水线 | 上传主题 → 触发一次完整构建把主题编进 bundle → 重新部署 Worker | ❌ 否决。启用一个主题要等一次 CI 构建；陌生人提交的组件代码在构建期执行等于任意代码执行（供应链攻击面）；多主题全量打进 bundle 会撑爆 Workers 大小上限 |
| B. 沙箱模板引擎 | 主题使用**声明式模板语言**（Liquid），Worker 内嵌解释器在请求时渲染；主题文件存 R2，不进 bundle | ✅ 采用。这是与「PHP 之于 WordPress」同构的模型：模板语言就是平台的原生方言。Liquid 为 Shopify 设计，天然沙箱化、无 eval、可在 Workers 运行 |

**关键推论**：第三方主题**不能包含可执行 JS**。主题的能力边界 = 模板语言的表达力 + 平台暴露的数据 API + 钩子系统。这条边界同时就是安全边界。

---

## 1. 总体架构

```
请求 → 中间件(边缘缓存) → 路由页(瘦壳)
  → 主题解析器 engine.ts
      ├─ 内置主题(theme=astro-native)：走现有 Astro 组件链（零改动）
      └─ 上传主题(engine=liquid)：R2 取模板 → 内存解析缓存 → liquid.render(context)
  → context.ts 组装数据 API（site/page/posts/pagination/hooks）
  → hooks.ts 把共享功能组件（Comments/Like/Toc…）预渲染成 HTML 片段注入
  → 响应（含 /themes/<name>/assets/* 静态资源路由）
```

- **双引擎共存**：现有站点整体作为内置主题 `astro-native`，不做重写；仅当激活上传主题时才走 Liquid 引擎。风险隔离，随时可回退。
- **存储分工**：D1 存注册表与定制值；R2 存包与解压后的模板/资源（不占 Worker bundle）；内存 LRU 缓存已解析模板（按 theme_id + 版本号失效）。

## 2. 主题包格式

```
my-theme.zip
├─ theme.json            # 清单（见下）
├─ layouts/
│  ├─ base.liquid        # HTML 外壳 <head>/<nav>/<footer>
│  ├─ home.liquid        # 卷首（文集门户 + 最新文章）
│  ├─ collection.liquid  # 文集归档
│  ├─ post.liquid        # 文章详情
│  ├─ page.liquid        # 独立页面
│  ├─ archive.liquid     # 时间归档 / 标签 / 搜索结果（共用）
│  └─ 404.liquid
├─ partials/*.liquid     # 可被 {% render %} 复用的片段
├─ assets/
│  ├─ css/*.css          # 仅静态 CSS（构建期清洗）
│  ├─ img/*  fonts/*
└─ screenshot.png        # 后台预览图（≤300KB）
```

`theme.json`：

```jsonc
{
  "name": "月见草",
  "slug": "tsukimiso",
  "version": "1.0.0",
  "engine": "liquid",
  "engine_version": "1",       // 数据 API 契约版本，兼容矩阵依据
  "author": "...",
  "license": "AGPL-3.0-or-later",
  "parent": null,               // 子主题填父主题 slug
  "hooks": ["head_meta", "comments", "post_like", "footer"],
  "customizer": {               // Customizer 设置模式（第 5 节）
    "accent_color": { "type": "color", "default": "#c23a30", "label": "强调色" },
    "font_heading": { "type": "select", "options": ["serif", "sans"], "default": "serif" }
  }
}
```

**硬限制**（上传校验）：zip ≤ 5MB、解压 ≤ 15MB、文件数 ≤ 200、单模板 ≤ 256KB、路径禁 `..` 与绝对路径、扩展名白名单（`.liquid/.css/.png/.jpg/.svg/.woff2`…）、CSS 禁外链 `@import/url()`、总 CSS ≤ 512KB。

## 3. 数据 API 契约（对第三方作者的「The Loop」）

模板自动转义开启；仅 `content_html` 与 `hook_*` 允许原始 HTML。

```liquid
{{ site.title }} {{ site.url }} {{ site.nav }} {{ user.username }}

{% for post in posts %}          {# 列表页上下文 #}
  <a href="{{ post.url }}">{{ post.title }}</a>
  {{ post.excerpt }} {{ post.date }} {{ post.collection.title }}
  {% for tag in post.tags %}{{ tag.name }}{% endfor %}
{% endfor %}

{{ pagination.prev_url }} {{ pagination.next_url }} {{ pagination.pages }}

{# 详情页上下文 #}
{{ post.title }}
{{ post.content_html }}         {# 已 sanitize 的渲染结果（KaTeX/Mermaid 容器等）#}
{{ post.toc }} {{ post.views }} {{ post.like_count }}
{% render 'partials/post-card', post: post %}
```

契约以 `engine_version` 冻结管理：字段只增不删；废弃先标 `deprecated` 至少两个次版本。**这是整个系统的 API 稳定性根基，必须先于一切代码产出文档（`docs/theme-spec.md`）。**

## 4. 钩子系统（wp_head / wp_footer 等价物）

主题在布局中放置占位：`{{ hook.head_meta }}`、`{{ hook.comments }}`、`{{ hook.post_like }}`、`{{ hook.footer }}`…

服务端流程：
1. `hooks.ts` 注册表维护钩子名 → 渲染函数；
2. 渲染时把共享 Astro 组件（`Comments.astro`、`PostLike.astro` 等）经 `experimental_AstroContainer` 渲染成 HTML 字符串挂到 context；
3. 未实现的钩子输出空串——**旧主题遇到新增功能自动静默降级**（如评论不可见的主题仍保留文章正文），并在后台兼容性检查中给出提示。

首版钩子集（最小完备）：`head_meta / nav_after / post_before / post_comments / post_like / post_share / archive_item_after / footer`。

## 5. 子主题与 Customizer

**子主题**：manifest 声明 `parent`。模板解析顺序 = 子主题目录 → 父主题目录 → 报错；assets 同理回退。深度限 1 层（不允许孙主题）。典型用法：只覆盖 `base.liquid` + 一个 css 改配色排版。

**Customizer**：
1. 作者在 `theme.json.customizer` 声明设置模式（color/select/text/number/boolean/image）；
2. 后台按模式**自动生成表单**（AppearanceView 内嵌区块），值存 `theme_settings` 表（JSON，per theme_id）；
3. 渲染时注入 context `{{ theme.accent_color }}` 并生成 `:root { --tk-accent: … }` CSS 变量段，主题 CSS 全部基于变量编写。
4. 图片类设置复用现有 R2 媒体库选择器。

## 6. 数据库与 API（迁移 0033 起）

```sql
CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,          -- theme.json 原文
  r2_prefix TEXT NOT NULL,         -- themes/<slug>/<version>/
  builtin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE theme_settings (
  theme_id INTEGER PRIMARY KEY REFERENCES themes(id),
  values TEXT NOT NULL DEFAULT '{}'
);
-- settings 表新增：active_theme(slug)、theme_epoch(int，切换/定制时 +1)
```

| 路由 | 说明 |
|---|---|
| `GET/POST /api/admin/themes` | 列表 / 上传 zip（校验→解压入 R2→写注册表） |
| `POST /api/admin/themes/:id/activate` | 启用（互斥置位 + `theme_epoch++` + 边缘缓存全站清除） |
| `GET/PUT /api/admin/themes/:id/settings` | Customizer 读写 |
| `DELETE /api/admin/themes/:id` | 删除（active 拒绝） |
| `GET /themes/:slug/assets/*` | R2 流式响应，`Cache-Control: immutable`（URL 含版本段） |

预览：管理员会话带 `?preview=<slug>` 时按该主题渲染且绕过边缘缓存；普通访客不受影响。

## 7. 安全模型

| 面 | 措施 |
|---|---|
| 任意代码执行 | 模板语言无逻辑逃逸：过滤器白名单、禁自定义 JS、liquid 关闭 `{% raw %}` 之外的元编程面 |
| DoS | 单次渲染时间预算（如 50ms 软超时抛错降级内置主题）、include/render 深度 ≤ 8、循环次数上限 |
| Zip 炸弹 / 路径穿越 | 上传时双重限制（压缩前后体积比、条目数）、逐条目路径规范化校验 |
| CSS 注入 | 构建期清洗：剥 `@import`、外链 `url()`、`expression`；注入 CSP `style-src 'self'` 不变 |
| 资源滥用 | assets 扩展名/MIME 白名单，仅 GET，immutable 缓存 |
| 上传入口 | 仅管理员可上传（本博客单作者模型下即「自己审核自己」，第三方分发需另行引入人工审核流程——超出本期范围） |
| 降级保障 | 渲染异常一律 catch → 回退 `astro-native` 并后台告警，前台永不 500 |

## 8. 里程碑（估算：全职约 4–5 周）

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| P0 契约冻结 | `docs/theme-spec.md`：数据 API、钩子清单、manifest、目录规范 | 契约文档（代码动工前置条件） | 2–3 天 |
| P1 引擎落地 | liquidjs 集成（沙箱配置/过滤白名单/解析缓存）、双引擎解析器、context 组装 | 用 Liquid 手抄一份当前首页+文章页做金样验证，视觉回归对比 | 1–1.5 周 |
| P2 钩子与功能岛 | hooks 注册表、Astro 组件服务端串渲染、降级策略 | 评论/点赞/TOC 在 Liquid 主题内可用 | 3–4 天 |
| P3 包管理与后台 | zip 校验管道、R2 存储、themes API、AppearanceView（列表/上传/预览/启用/删除）、资产路由 | 端到端可安装可切换 | 1 周 |
| P4 Customizer + 子主题 | 设置模式→自动表单、CSS 变量注入、父级回退解析 | 无代码换色改排版 | 4–5 天 |
| P5 生态配套 | `pnpm new-theme` 脚手架、示例主题 starter、主题开发文档站（可直接用本仓库 /pages 托管） | 第三方作者可上手 | 3–4 天 |
| 贯穿 | e2e（切主题/预览/降级/缓存失效）、性能基线（冷启动渲染耗时）、安全自查 | 测试绿 + 文档 | — |

## 9. 风险与诚实的代价清单

1. **数据 API 是永久承诺**：每次核心功能演进都要评估是否进契约、是否加钩子；契约漂移会碎裂所有第三方主题。单人维护的开源项目长期背负此债是最主要成本。
2. **功能可见性滞后**：新功能上线时旧主题因未放钩子而看不到（靠降级兜底 + 升级提示缓解）。
3. **性能**：R2 取模板 + 解释执行比编译期 Astro 慢，冷启动更明显；解析缓存 + 模板预热可压到接近，但需要持续观测。
4. **AGPL 合规引导**：需在主题规范中明确建议作者以同等或兼容协议分发，避免法律灰色地带。
5. **支持面扩大**：接受第三方主题 = 接受「为什么我的主题显示不了 XX」类 issue 流。
6. **回滚成本低是本方案的保险丝**：任何阶段出问题，激活态切回 `astro-native` 即恢复原状，数据无损。

## 10. 明确不做（Non-goals）

- 主题市场 / 在线商店分发
- 拖拽可视化建站编辑器
- 主题内执行第三方 JS（永不允许，CSP 不开洞）
- 插件系统（另一独立且更大的工程）
