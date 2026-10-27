@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] 正在创建虚拟环境并安装依赖...
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo [2/2] 正在启动问卷洞察...
echo 访问地址: http://127.0.0.1:5000
echo 按 Ctrl+C 停止服务
".venv\Scripts\python.exe" app.py
pause
