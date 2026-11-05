# Node 后端改造说明

本分支（`feat/node-backend`）把项目从 **Cloudflare Workers + D1 + R2** 迁移到
**原生 Node.js + node:sqlite + 本地文件系统**，可直接跑在任何 x86 Linux 服务器上。

改造原则：**业务代码零改动**。全站 548 处 D1 调用、所有 Astro 路由、所有 Vue 组件
一行没动，靠三个兼容层把平台能力补齐。这样上游的 bug 修复与功能更新都能直接
`git merge` 过来，不会因为这次改造而分叉。

---

## 一、架构对照

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

## 二、三个兼容层

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

## 三、必须知道的两个坑

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

## 四、目录结构

```
server/
├── index.mjs     启动入口：装配 env → 迁移 → 注入 → 起 HTTP → 定时器 → 优雅关闭
├── env.mjs       Env 装配：D1/R2/ASSETS 实例 + 环境变量，对齐 src/env.d.ts
├── d1.mjs        D1 兼容层（node:sqlite）
├── d1.d.mts      d1.mjs 的类型声明（.mjs 无法携带泛型）
├── r2.mjs        R2 兼容层（本地文件系统）+ ASSETS 兼容
├── cache.mjs     进程内 LRU 页面缓存
├── static.mjs    SSR-first 静态分发与缓存头
└── migrate.mjs   迁移执行器（含 CLI）

deploy/
└── blog.service  systemd 单元（含安全加固）

Dockerfile        两阶段构建镜像
.env.example      全部配置项与默认值
```

---

## 五、本地运行

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

打开 http://localhost:4321 ，用 `admin` + `BLOG_ADMIN_PASSWORD` 登录后台。

`data/` 目录（默认）下会有：

```
data/
├── blog.db        SQLite（WAL 模式，同目录有 -wal / -shm）
└── blobs/         上传的文件
    ├── uploads/...
    └── .meta/      元信息（内部目录，不对外暴露）
```

---

## 六、生产部署

### 方式 A：systemd（推荐，最省资源）

```bash
sudo useradd --system --home /opt/blog blog
sudo mkdir -p /opt/blog /var/lib/blog /etc/blog
sudo chown -R blog:blog /opt/blog /var/lib/blog

# 部署代码 + 构建产物
sudo rsync -a --exclude node_modules ./ /opt/blog/
cd /opt/blog && pnpm install --prod && pnpm run build

# 配置
sudo cp .env.example /etc/blog/blog.env
sudo chmod 600 /etc/blog/blog.env
sudo vim /etc/blog/blog.env        # 至少填 SESSION_SECRET、ADMIN_PASSWORD、SITE_URL

# 服务
sudo cp deploy/blog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now blog
sudo journalctl -u blog -f
```

Nginx 反代要点（务必保留这几项）：

```nginx
location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # 中间件靠它判断 HTTPS
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 20m;                     # 图片上传
}
```

### 方式 B：Docker

```bash
docker build -t blog:latest .
docker run -d --name blog \
  -p 4321:4321 \
  -v /srv/blog-data:/data \
  -e BLOG_SESSION_SECRET="$(openssl rand -base64 48)" \
  -e BLOG_ADMIN_PASSWORD="change-me" \
  -e SITE_URL="https://blog.example.com" \
  blog:latest
```

---

## 七、测试

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

---

## 八、迁移清单（相对 Cloudflare 版）

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

## 九、已知差异

| 项             | 说明                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| 缓存范围       | 单进程内存，不跨实例。多实例部署时各持有，靠 TTL 收敛                                                     |
| `meta.changes` | batch 内返回逐语句真实值，比 D1 的累计值更精确（业务已规避该差异）                                        |
| 静态资源       | 由自己判定而非平台，规则见 `server/static.mjs` 顶部注释                                                   |
| Node 版本      | 需要 ≥ 22（`node:sqlite` 依赖），实际在 24.22 上验证                                                      |
| `/404` 语义    | 全站用 `Astro.redirect('/404')` 表达不存在，对外是 302 → /404（与 Cloudflare 版一致，仅测试断言方式不同） |
