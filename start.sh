#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -x ".venv/bin/python" ]; then
  echo "[1/2] 创建虚拟环境并安装依赖..."
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi
echo "[2/2] 启动问卷洞察: http://127.0.0.1:5000"
.venv/bin/python app.py
