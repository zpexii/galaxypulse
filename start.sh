#!/usr/bin/env bash
# GalaxyPulse 一键启动 (macOS / Linux)
# 用法: ./start.sh          使用默认端口 8000
#       PORT=9000 ./start.sh   自定义端口

set -e

# ---- 1. 项目根目录 (脚本所在目录) ----
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---- 2. 找 Python ----
PY=""
for candidate in python3 python; do
    if command -v "$candidate" &>/dev/null; then
        PY="$candidate"
        break
    fi
done
if [ -z "$PY" ]; then
    echo "❌ 没找到 python, 请先装 Python 3 (https://www.python.org/downloads/)"
    exit 1
fi
echo "✅ 使用 $($PY --version) → $PY"

# ---- 3. 检查/安装 requests (可选, 缺了也能跑, 会走 urllib 兜底) ----
if ! $PY -c "import requests" 2>/dev/null; then
    echo "⚠️  未安装 requests, 首次使用请执行: pip3 install requests"
    echo "   (不装也能跑, 只是数据拉取稍慢)"
fi

# ---- 4. 端口 ----
PORT="${PORT:-8000}"
if lsof -i ":$PORT" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "⚠️  端口 $PORT 已被占用, 换个端口试试: PORT=9000 ./start.sh"
    exit 1
fi

# ---- 5. 启动 ----
echo ""
echo "=========================================="
echo "  GalaxyPulse · 纳斯达克助手 启动中"
echo "  端口:   $PORT"
echo "  本机:   http://localhost:$PORT"
echo "  局域网: http://<你的IP>:$PORT  (手机同WiFi可开)"
echo "  停止:   Ctrl + C"
echo "=========================================="
echo ""

exec $PY backend/server.py
