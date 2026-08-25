@echo off
chcp 65001 >nul
title 月下独酌 · 一键部署向导
rem ============================================================
rem  一键部署向导（Windows）
rem  作用：检查/安装 Node.js 与 pnpm，然后启动部署向导脚本。
rem  用法：双击 setup.bat
rem ============================================================

echo.
echo  ============================================================
echo    月下独酌 · 一键部署向导（Windows）
echo  ============================================================
echo.

rem ---- 第一步：检查/安装 Node.js ----
where node >nul 2>nul
if %errorlevel%==0 (
  echo  [OK] Node.js 已安装：node -v
  node -v
) else (
  echo  [待安装] 未检测到 Node.js，尝试自动安装…
  where winget >nul 2>nul
  if %errorlevel%==0 (
    echo  [安装] 使用 winget 安装 Node.js LTS…
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  ) else (
    echo  [提示] 未找到 winget。请手动安装 Node.js ^>= 22：
    echo       https://nodejs.org/
    echo  安装后重新双击本脚本。
    pause
    exit /b 1
  )
  where node >nul 2>nul
  if %errorlevel%==0 (
    echo  [OK] Node.js 安装成功：node -v
    node -v
  ) else (
    echo  [提示] 安装后请重新打开一个终端，再双击本脚本。
    pause
    exit /b 1
  )
)

rem ---- 第二步：检查/安装 pnpm ----
where pnpm >nul 2>nul
if %errorlevel%==0 (
  echo  [OK] pnpm 已安装：pnpm -v
  pnpm -v
) else (
  echo  [待安装] 未检测到 pnpm，使用 npm 全局安装…
  call npm install -g pnpm
  where pnpm >nul 2>nul
  if %errorlevel%==0 (
    echo  [OK] pnpm 安装成功：pnpm -v
    pnpm -v
  ) else (
    echo  [提示] pnpm 安装失败。请手动运行：npm install -g pnpm
    pause
    exit /b 1
  )
)

echo.
echo  [下一步] 启动部署向导…
echo.
setlocal
cd /d %~dp0
node scripts/setup-deploy.mjs
endlocal

echo.
pause