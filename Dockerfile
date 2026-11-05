# 月下独酌 · blog — Node 后端镜像
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 两阶段构建：builder 装依赖+编译，runner 只带产物与运行时依赖。
# 最终镜像不含源码、不含 devDependencies，体积更小、攻击面更少。

# ---------------- 构建阶段 ----------------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# 构建期变量：主题（modern / classic）。要换主题必须重新构建。
ARG BLOG_THEME=modern
ENV BLOG_THEME=${BLOG_THEME}

# 先只拷依赖清单，利用层缓存：源码改动不会触发重新装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json ./admin/
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --frozen-lockfile

# 再拷源码
COPY . .

# 构建前台（Astro）+ 后台（Vue）+ 合并产物
RUN pnpm run build

# 只装生产依赖，供 runner 阶段使用
RUN pnpm prune --prod

# ---------------- 运行阶段 ----------------
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4321 \
    HOST=0.0.0.0

# 数据目录单独声明为 volume：数据库与上传文件都在这里，容器重建不丢
ENV BLOG_DATA_DIR=/data
VOLUME ["/data"]

# 运行期只需要：产物、依赖、服务端脚本、迁移 SQL、包清单
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./package.json

# 非 root 运行
RUN useradd --system --uid 10001 --create-home blog \
    && mkdir -p /data \
    && chown -R blog:blog /data /app
USER blog

EXPOSE 4321

# 健康检查走 /__health（不打 SSR，不查库，代价极低）
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/__health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]