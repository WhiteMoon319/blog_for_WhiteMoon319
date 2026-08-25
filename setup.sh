#!/usr/bin/env bash
# ============================================================
#  一键部署向导（macOS / Linux）
#  作用：检查/安装 Node.js 与 pnpm，然后启动部署向导脚本。
#  用法：./setup.sh（首次需要 chmod +x setup.sh）
# ============================================================

set -e
cd "$(dirname "$0")"

echo ""
echo "============================================================"
echo "  月下独酌 · 一键部署向导（macOS / Linux）"
echo "============================================================"
echo ""

# ---- 第一步：检查/安装 Node.js ----
if command -v node >/dev/null 2>&1; then
  echo "  [OK] Node.js 已安装：$(node -v)"
else
  echo "  [待安装] 未检测到 Node.js，尝试自动安装…"
  if command -v brew >/dev/null 2>&1; then
    echo "  [安装] 使用 Homebrew 安装 Node.js…"
    brew install node
  elif command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    echo "  [安装] 使用 apt 安装 Node.js…"
    apt-get update && apt-get install -y nodejs npm
  else
    echo "  [提示] 无法自动安装。请手动安装 Node.js（≥ 22）："
    echo "        https://nodejs.org/"
    echo "  或用 Homebrew：brew install node"
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "  [提示] Node.js 安装后请重新运行 ./setup.sh"
    exit 1
  fi
  echo "  [OK] Node.js：$(node -v)"
fi

# ---- 第二步：检查/安装 pnpm ----
if command -v pnpm >/dev/null 2>&1; then
  echo "  [OK] pnpm 已安装：$(pnpm -v)"
else
  echo "  [待安装] 未检测到 pnpm，使用 npm 全局安装…"
  npm install -g pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "  [提示] pnpm 安装失败。请手动运行：npm install -g pnpm"
    exit 1
  fi
  echo "  [OK] pnpm：$(pnpm -v)"
fi

echo ""
echo "  [下一步] 启动部署向导…"
echo ""
node scripts/setup-deploy.mjs