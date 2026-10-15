@echo off
rem GalaxyPulse 一键启动 (Windows)
rem 用法: start.bat          默认端口 8000
rem       set PORT=9000 && start.bat   自定义端口

chcp 65001 >nul
setlocal

rem ---- 1. 项目根目录 ----
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

rem ---- 2. 找 Python ----
set "PY="
where python3 >nul 2>nul && set "PY=python3"
if "%PY%"=="" where python >nul 2>nul && set "PY=python"
if "%PY%"=="" (
    echo ❌ 没找到 Python, 请先装 Python 3 (https://www.python.org/downloads/)
    pause
    exit /b 1
)
echo ✅ 使用 %PY%

rem ---- 3. 检查 requests ----
%PY% -c "import requests" 2>nul
if errorlevel 1 (
    echo ⚠️  未安装 requests, 首次使用请执行: pip install requests
    echo    (不装也能跑, 只是数据拉取稍慢)
)

rem ---- 4. 端口 ----
if "%PORT%"=="" set "PORT=8000"

rem ---- 5. 启动 ----
echo.
echo ==========================================
echo   GalaxyPulse · 纳斯达克助手 启动中
echo   端口:   %PORT%
echo   本机:   http://localhost:%PORT%
echo   局域网: http://你的IP:%PORT%  (手机同WiFi可开)
echo   停止:   Ctrl + C
echo ==========================================
echo.

set "PORT=%PORT%"
%PY% backend\server.py

pause
