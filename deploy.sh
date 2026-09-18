#!/usr/bin/env bash
# ============================================================
#  日常更新：构建 → 远程迁移 → 部署 Worker（等价于 pnpm run deploy）
#  若处于「自带环境」发布包（存在 runtime/），自动注入包内运行时。
#  用法：./deploy.sh（首次需要 chmod +x deploy.sh）
# ============================================================

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ -x "$DIR/runtime/node/bin/node" ]; then
  export PATH="$DIR/runtime/node/bin:$DIR/runtime/bin:$PATH"
fi

pnpm run deploy
