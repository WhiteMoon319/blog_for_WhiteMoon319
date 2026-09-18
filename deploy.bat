@echo off
chcp 65001 >nul
title 月下独酌 · 日常更新部署
rem ============================================================
rem  日常更新：构建 → 远程迁移 → 部署 Worker（等价于 pnpm run deploy）
rem  若处于「自带环境」发布包（存在 runtime\），自动注入包内运行时。
rem  用法：双击 deploy.bat
rem ============================================================

setlocal
cd /d "%~dp0"

if exist "%~dp0runtime\node\node.exe" (
  set "PATH=%~dp0runtime\bin;%~dp0runtime\node;%~dp0runtime\git\cmd;%~dp0runtime\git\mingw64\bin;%PATH%"
)

call pnpm run deploy

echo.
pause
