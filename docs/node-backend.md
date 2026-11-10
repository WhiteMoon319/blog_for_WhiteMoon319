# 双平台说明（Node 后端 + Cloudflare 单包）

本分支（`feat/node-backend`）把项目改造成 **一份代码、两个构建目标**：

- `BLOG_TARGET=cloudflare`（**默认**）：产物与主线完全一致，跑在 Cloudflare Workers + D1 + R2 上；
- `BLOG_TARGET=node`：产物跑在原生 Node.js + `node:sqlite` + 本地文件系统上，可部署到任何 x86 Linux 服务器。

改造原则：**业务代码零改动**。全站 548 处 D1 调用、所有 Astro 路由、所有 Vue 组件
一行没动，靠兼容层在运行时探测平台并分流。**因此合回主线不会影响 Cloudflare 版**——
默认目标就是 CF，不设 `BLOG_TARGET` 时行为与改造前完全一致。

---

## 一、怎么选目标

```bash
# Cloudflare（默认，不设 BLOG_TARGET 就是它）
pnpm run build          # → dist/ 交给 wrangler
pnpm run cf:deploy

# Node 服务器
BLOG_TARGET=node pnpm run build
BLOG_TARGET=node pnpm start     # 需 Node >= 22
```

四个分流点，全部自动判定，不需要手改代码：

| 分流点       | 判定方式             | 说明                                                                                    |
| ------------ | -------------------- | --------------------------------------------------------------------------------------- |
| 构建适配器   | 构建期 `BLOG_TARGET` | `astro.config.mjs` 选 `@astrojs/cloudflare` 或 `@astrojs/node`                          |
| 运行环境 env | 运行期探测           | 先看 `globalThis.__BLOG_ENV_RESOLVER__`（Node 注入），再 `import('cloudflare:workers')` |
| 页面缓存     | 运行期探测           | 先看 `__BLOG_PAGE_CACHE__`（Node 注入），再 `caches.default`，都没有则 NOOP             |
| 静态资源分发 | 构建期               | Node 走 `server/static.mjs`，CF 走 `run_worker_first`                                   |

平台探测统一在 `src/lib/platform.ts`。注意 Workers 判定用的是
`WebSocketPair` + `caches` 双重特征，**不能只看 `caches`**——Node 20+ 也有全局 `caches`。

---

## 二、Node 侧改造细节

本节及其后是 Node 侧的改造细节；只关心 Cloudflare 的读者可以停在上面「一」。

### 架构对照

| 能力        | Cloudflare 版                  | Node 版                              |
| ----------- | ------------------------------ | ------------------------------------ |
| HTTP 运行时 | Workers（V8 isolate）          | `node:http` + `@astrojs/node`        |
| 构建适配器  | `@astrojs/cloudflare`          | `@astrojs/node`（standalone）        |
| 数据库      | D1                             | `node:sqlite`（`server/d1.mjs`）     |
| 对象存储    | R2                             | 本地文件系统（`server/r2.mjs`）      |
| 静态资源    | Workers Assets 绑定            | `dist/client` + `server/static.mjs`  |
| 页面缓存    | Cache API（`caches.default`）  | 进程内 LRU（`server/cache.mjs`）     |
| env 注入    | 平台隐式注入模块级 `env`       | 启动时注入解析器（`server/env.mjs`） |
| 定时发布    | `wrangler triggers.crons`      | `setInterval` + 内部路由             |
| 迁移        | `wrangler d1 migrations apply` | `server/migrate.mjs`                 |

---

### 三个兼容层

### 1. D1 兼容层 —— `server/d1.mjs`

业务侧只依赖这套窄接口：

```js
db.prepare(sql) → stmt
stmt.bind(...args) → stmt
stmt.first() / stmt.all() / stmt.run()
db.batch([stmt, ...])
```

返回值只用 `{ results, meta.changes, meta.last_row_id }`。兼容层把这套语义映射到
`node:sqlite`，并处理了 6 个容易踩的差异：

| 差异             | D1 行为            | node:sqlite 行为 | 处理方式                     |
| ---------------- | ------------------ | ---------------- | ---------------------------- |
| `first()` 空结果 | `null`             | `undefined`      | 统一返回 `null`              |
| `all()` 空结果   | `{ results: [] }`  | `[]`             | 统一包成 `{ results: [] }`   |
| `batch()` 事务   | 隐式事务，整批回滚 | 无               | 显式 `BEGIN/COMMIT/ROLLBACK` |
| 布尔绑定         | 报错               | 接受             | 归一成 `1/0`                 |
| 返回行原型       | 普通对象           | null-prototype   | 转成普通对象                 |
| `meta.changes`   | batch 内为累计值   | 逐语句真实值     | 返回逐语句真实值（更精确）   |

**为什么不用 better-sqlite3**：Node 22+ 内置 `node:sqlite`，无原生编译、
无 node-gyp、无预编译二进制下载，部署链路更短。代价是需要 Node ≥ 22。

### 2. R2 兼容层 —— `server/r2.mjs`

映射到 `BLOB_DIR` 下的普通文件，`key` 直接就是相对路径（`uploads/2026/11/uuid.png`）。

实现 `put / get / head / list / delete`，并额外处理三件线上会踩到的事：

1. **路径穿越防护**：拒绝 `..`、绝对路径、盘符，且解析后必须落在根目录内
2. **`httpMetadata` 持久化**：Content-Type 存在 `.meta/<key>.json`，否则取回时
   浏览器会把图片当 `application/octet-stream`
3. **`.meta` 目录隔离**：元信息不放数据文件旁边（否则会被 `list()` 当成素材条目，
   污染后台媒体库）

### 3. 缓存适配层 —— `src/lib/cache.ts` + `server/cache.mjs`

原 `middleware.ts` 直接调 Workers 全局 `caches.default`。改成注入式接口
（`match` / `put`），生产环境用带 TTL 的内存 LRU（默认 64MB / 60s）。

单机部署没有边缘层，LRU 挡的是"匿名 GET 的重复 SSR + D1 查询"，收益与
Workers 缓存等价。多实例部署时各实例各自持有，一致性仍由
`Cache-Control: max-age=60` 保证。

---

### 必须知道的两个坑

### 坑 1：`ASTRO_NODE_AUTOSTART=disabled`

`@astrojs/node@11.1.9` 的 `standalone()` 会调 `app.getLogger()`，
而 `astro@7.2` 的 App 已移除该方法。走自动启动会在 `listen` 成功**之后**
抛 `TypeError` 并以退出码 1 结束——端口短暂可用然后进程消失，很难排查。

因此 `server/index.mjs` 在 import `entry.mjs` 之前设置：

```js
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
```

然后自己起 `http.Server`，用 `entry.mjs` 导出的 `handler`。顺带拿到了
健康检查（`/__health`）和精确的优雅关闭。

### 坑 2：静态资源会抢走 SSR 路由

`@astrojs/node` 的 standalone handler 是 **static 先跑**；Cloudflare 版靠
`run_worker_first: true` 保证 **Worker 先跑**。这个差异带来三个实际问题：

1. `/admin/`、`/write/` 命中磁盘上的 `index.html`，绕过路由设置的
   `no-store` / `X-Robots-Tag` / CSP
2. `/write/assets/*.js` 由 `send` 直接发，拿不到 `immutable` 缓存头
3. 目录存在时触发 trailingSlash 重定向，把该交给 SSR 的路径改写掉

解决办法（`server/static.mjs` + `scripts/merge-admin.mjs`）：

- 构建后删除 `dist/client/{admin,write}/index.html`（它们已被路由以 `?raw` 内联）
- 自己实现"只有真实存在的带扩展名文件才走静态"的判定，其余交给 SSR
- 静态响应按是否带内容 hash 给缓存头（哈希产物 `immutable`，其余 `must-revalidate`）

---

### 目录结构

```
server/
├── index.mjs     启动入口：装配 env → 迁移 → 注入 → 起 HTTP → 定时器 → 优雅关闭
├── env.mjs       Env 装配：D1/R2/ASSETS 实例 + 环境变量，对齐 src/env.d.ts
├── d1.mjs        D1 兼容层（node:sqlite）
├── d1.d.mts      d1.mjs 的类型声明（.mjs 无法携带泛型）
├── r2.mjs        R2 兼容层（本地文件系统）+ ASSETS 兼容
├── cache.mjs     进程内 LRU 页面缓存
├── static.mjs    SSR-first 静态分发与缓存头
├── cf-import.mjs Cloudflare 数据导入（D1 导出 + R2 下载）
├── cf-import.d.mts cf-import.mjs 的类型声明
└── migrate.mjs   迁移执行器（含 CLI）

deploy/
└── blog.service  systemd 单元（含安全加固）

Dockerfile        两阶段构建镜像
.env.example      全部配置项与默认值
```

---

## 三、从 Cloudflare 迁移数据

已经用 Workers 版跑过一段时间、线上有真实数据时，用 `server/cf-import.mjs`
一键搬迁，不需要手工导出 SQL，也不需要 `wrangler login`。

### 1. 准备 API Token

到 Cloudflare 仪表盘 → My Profile → API Tokens → Create Token，用
**Custom token**，需要这两项权限：

| 权限 | 级别 | 用途           |
| ---- | ---- | -------------- |
| D1   | Read | 列库、导出 SQL |
| R2   | Read | 列桶、下载对象 |

再补一个 **Account Resources → Include → 你的账号**，以及 **User → User Details: Read**
（用于 `/user/tokens/verify` 校验）。Account ID 在仪表盘右侧栏或 URL 里
（`dash.cloudflare.com/<ACCOUNT_ID>/...`）。

### 2. 先干跑确认资源

```bash
pnpm run cf:import -- --token=<TOKEN> --account=<ACCOUNT_ID> --dry-run
```

输出会列出账号下的 D1 库和 R2 桶，确认它选中了 `blog-db` / `blog-images`。
名字不一致时用 `--database=<name|uuid>`、`--bucket=<name>` 指定。

### 3. 正式导入

```bash
pnpm run cf:import -- --token=<TOKEN> --account=<ACCOUNT_ID>
```

流程与产物：

```
1/5 校验 token
2/5 定位资源（D1 库 / R2 桶）
3/5 导出 D1 → 下载 SQL → 写入 $BLOG_DB_PATH
4/5 列出 R2 对象（分页拉全）
5/5 下载对象到 $BLOG_BLOB_DIR
```

结束后直接 `pnpm start:prod`，用**原来的账号密码**登录后台即可，文章、评论、
用户、阅读历史、图片全部在位。

### 4. 目标库已有数据时

默认拒绝覆盖。确认要覆盖时加 `--force`，脚本会先 `VACUUM INTO` 备份原库
（生成 `blog.db.backup-<时间戳>`）再导入。

### 5. 导入时做了什么（关键细节）

这几处如果处理错了，会静默丢失功能，所以单独说明：

1. **D1 导出用 `compatibility: 'sqlite3_cli_only'`**
   本项目有 FTS5 外部内容表 `posts_fts`。默认的 `d1` 格式**不导出虚拟表**，
   导进来之后 `posts_fts` 不存在，站内搜索会直接报错。用 CLI 格式才能带上
   `CREATE VIRTUAL TABLE` 与三个同步触发器。

2. **导入后强制 `rebuild` 全文索引**
   trigram 索引对内容敏感，直接从别处搬来的索引可能与数据对不上，统一重建一次。

3. **补登 `d1_migrations`**
   dump 里通常不含这张表的数据。如果不补，下次启动 `runMigrations` 会对着
   已经存在的表再跑一遍 `CREATE TABLE`，服务直接起不来。导入末尾会自动把
   `db/migrations/` 下的全部文件名登记为已应用（幂等）。

4. **R2 对象 key 的 `/` 不编码**
   Cloudflare 明确要求保留斜杠字面量；逐段 `encodeURIComponent` 后拼接。

5. **元信息写进 `.meta/`**
   与 `NodeR2Bucket` 同一套布局，保留原 `http_metadata.contentType`，
   否则图片取回时会变成 `application/octet-stream`。

6. **路径穿越防护**
   导入时对每个 key 做与运行时相同的校验，`../`、绝对路径、盘符一律跳过。

### 6. 常见错误

| 现象                                    | 原因与处理                                                     |
| --------------------------------------- | -------------------------------------------------------------- |
| `找不到数据库 "blog-db"`                | 库名不同，用 `--database=<uuid>`；或只用 `--skip-db` 导文件    |
| `Authentication error` / 403            | token 缺 D1:Read 或 R2:Read，或 Account Resources 没包含该账号 |
| 导出卡住超过 10 分钟                    | 大库（>5GB）建议改用 `wrangler d1 export` 手动导入             |
| 导入后搜索报 `no such table: posts_fts` | 导出格式没用 `sqlite3_cli_only`；本脚本已默认处理              |
| 启动时报 `table posts already exists`   | `d1_migrations` 没补登；重跑导入脚本即可（会自动补）           |

> token 只在进程内存里用，不写日志、不落盘、不入库。

---

## 四、本地运行

```bash
# 1. 装依赖
pnpm install

# 2. 配置（可选：不配也能用默认值跑起来）
cp .env.example .env
# 至少改这两项，否则会有启动告警：
#   BLOG_SESSION_SECRET=<32 字节以上随机串>
#   BLOG_ADMIN_PASSWORD=<初始管理员密码>

# 3. 构建（前后台产物）
pnpm run build

# 4. 套用数据库迁移
pnpm run migrate

# 5. 启动
pnpm start           # 开发模式
pnpm start:prod      # 生产模式（自动迁移、更严格的检查）
```

打开 http://localhost:8020 ，用 `admin` + `BLOG_ADMIN_PASSWORD` 登录后台。

`data/` 目录（默认）下会有：

```
data/
├── blog.db        SQLite（WAL 模式，同目录有 -wal / -shm）
└── blobs/         上传的文件
    ├── uploads/...
    └── .meta/      元信息（内部目录，不对外暴露）
```

---

## 五、生产部署

完整步骤（systemd、nginx、gzip、字体、数据迁移）见
[README「部署到自己的服务器」](../README.md)。

这一节只记三个**容易踩**的点：

1. **健康检查是 `/__health`**，不是 `/api/health`。systemd 或负载均衡探活别填错。
2. **`pnpm start` 不走 `@astrojs/node` 的 autostart**，跑的是自写的 `server/index.mjs`；
   它负责注入 env / cache / 静态资源三个兼容层。绕过它直接跑 `dist/server/entry.mjs` 会缺这三样。
3. **gzip 必须显式配**。nginx 反代场景下 `gzip_proxied` 默认是 `off`，`gzip_types` 默认只含
   `text/html`，结果是 JS/CSS/JSON 全部整份裸传。实测补全后 JS −61%、CSS −77%。

Docker 方式仍可用（`Dockerfile` 在仓库根目录），端口映射改成 `-p 8020:8020` 即可。

---

## 六、测试

```bash
# 全量（313 个用例：单元 + e2e）
pnpm test

# 类型检查
pnpm run typecheck

# 注意：e2e 的阅读历史用例依赖 classic 主题的布局，
# 与上游 CI 一致，用 classic 主题构建后再跑：
BLOG_THEME=classic pnpm run build && pnpm test
```

e2e 不再用 miniflare，改为在测试进程内起真实 `http.Server` 打真实 HTTP
（`tests/helpers/e2e.ts`）。每个用例一套独立的内存库 + 临时目录，互不污染。

**两个实际踩过的坑**：
- e2e 有 dist 新鲜度门禁：源码一改就得重新 `pnpm run build` 再跑测试，否则整批失败。
- 别在 build 之后跑 `pnpm run format`，会触发上一条。

---

## 七、迁移清单（相对 Cloudflare 版）

**删除**

- `worker/worker.ts`、`worker/entry.mjs`、`tsconfig.worker.json`（cron 由 Node 承担）
- `scripts/build-worker.mjs`、`scripts/cf-config.mjs`（不再生成 wrangler 配置）
- `wrangler.jsonc.template`、`r2-cors.json`（无 Cloudflare 资源）

**依赖变化**

- 移除：`@astrojs/cloudflare`、`wrangler`、`miniflare`、`@cloudflare/workers-types`
- 新增：`@astrojs/node`

**新增**

- `server/`（6 个模块）、`src/lib/cache.ts`、`src/types/bindings.ts`
- `src/pages/api/internal/publish-due.ts`（定时发布内部路由）
- `deploy/blog.service`、`Dockerfile`

**修改**

- `src/lib/db/env.ts`：`cloudflare:workers` → 注入式解析器
- `src/middleware.ts`：`caches.default` → `pageCache()`
- `src/env.d.ts`：自建 `D1Database` 等全局类型，替代 workers-types
- `astro.config.mjs`：cloudflare → node adapter
- `tests/helpers/{d1,e2e}.ts`：miniflare → node:sqlite + 真实 HTTP
- `14 个 src/lib/db/*.ts`：类型导入改指向 `src/types/bindings.ts`

---

## 八、已知差异

| 项             | 说明                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| 缓存范围       | 单进程内存，不跨实例。多实例部署时各持有，靠 TTL 收敛                                                     |
| `meta.changes` | batch 内返回逐语句真实值，比 D1 的累计值更精确（业务已规避该差异）                                        |
| 静态资源       | 由自己判定而非平台，规则见 `server/static.mjs` 顶部注释                                                   |
| Node 版本      | 需要 ≥ 22（`node:sqlite` 依赖），实际在 24.22 上验证                                                      |
| `/404` 语义    | 全站用 `Astro.redirect('/404')` 表达不存在，对外是 302 → /404（与 Cloudflare 版一致，仅测试断言方式不同） |
| 构建内存       | Vite 打包 `PostEditorView`（1.25MB chunk）峰值较高；1.9G 内存机器会 `OOMErrorHandler` 退出（exit 134）。小内存建议本地构建后只上传 `dist/client/{admin,write}/assets` |
| 字体分发       | Node 不自带 R2，字体需先同步到 `data/blobs`（走路由）或设 `FONTS_BASE` 走静态直连；后者 4ms vs 路由 8–19ms |

---

## 九、备案信息（ICP / 公安联网备案）

国内服务器上线必须展示备案号。两个备案都是**选配开关**，默认关闭，
未备案的站点不会在页脚看到多余内容。

### 后台修改

后台 →「站点与内容」区，勾选开关并填写号码：

| 开关                     | 填写内容                     | 效果                             |
| ------------------------ | ---------------------------- | -------------------------------- |
| 在页脚显示 ICP 备案号    | `渝ICP备2026024373号-1`      | 页脚一行，链到 beian.miit.gov.cn |
| 在页脚显示公安联网备案号 | `渝公网安备50022302000935号` | 页脚一行，附国徽图标，链到查询页 |

两个开关互相独立，可以只开一个。

### 几个设计取舍

1. **开关和号码分开存**
   `beian_icp_enabled` / `beian_icp` 是两组设置。关掉开关不会清空号码，
   重新打开立刻恢复。这样「先填好、上线时再开」和「临时隐藏」都不用重填。

2. **公安备案的链接编号自动提取**
   查询接口要的是纯数字（`50022302000935`），而用户填的是完整文案
   （`渝公网安备50022302000935号`）。由 `mpsQueryCode()`（`src/core/utils.ts`）
   取最后一串 8 位以上数字。抽不出来时回退到 `https://beian.mps.gov.cn/`，
   不会拼出一个错参数的链接。

3. **国徽图标本地托管**
   `/assets/image/beian-mps.png`（62×67，随仓库提供），不热链政府站点，
   避免对方改路径或图片，也避免额外的一次跨站请求。

4. **号码不自动加「号」字**
   填什么显示什么。因为各地格式不同（有的带 `-1` 后缀），
   自动拼接反而容易出 `xx号号`。

### 环境变量兜底

不想用后台、想跟着部署走的话，可以设 `BEIAN_ICP` / `BEIAN_MPS`。
注意**开关仍要在后台打开**——环境变量只提供号码，不控制显示。

### 样式一致性

两个内置主题（classic / modern）都实现了这段页脚，各自用主题自己的配色，
在深色模式下也不会突兀。新增主题只需消费 `ctx.beianIcp` / `ctx.beianMps`
两个字段即可。
