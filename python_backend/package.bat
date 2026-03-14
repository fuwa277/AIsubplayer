@echo off
chcp 65001 >nul
echo ========================================
echo      AI 字幕播放器 后端一键打包脚本
echo ========================================

echo.
echo [1/4] 正在检测虚拟环境 (venv)...
if not exist "venv\Scripts\activate.bat" (
    echo [提示] 当前目录下未检测到 venv，正在自动创建...
    python -m venv venv
)

echo.
echo [2/4] 正在激活虚拟环境并安装依赖...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
echo 安装 requirements.txt 中的依赖...
pip install -r requirements.txt
echo 安装打包工具 PyInstaller...
pip install pyinstaller

echo.
echo [3/4] 正在进行环境健康测试 (加载核心重型依赖)...
:: 动态生成一个简易的 Python 探针脚本
echo import sys > env_test.py
echo try: >> env_test.py
echo     import fastapi >> env_test.py
echo     import uvicorn >> env_test.py
echo     import faster_whisper >> env_test.py
echo     import ctranslate2 >> env_test.py
echo     print("   - 环境健康测试通过，依赖已就绪！") >> env_test.py
echo     sys.exit(0) >> env_test.py
echo except ImportError as e: >> env_test.py
echo     print(f"   - [致命错误] 环境测试失败: {e}") >> env_test.py
echo     sys.exit(1) >> env_test.py

python env_test.py
if %errorlevel% neq 0 (
    echo.
    echo ----------------------------------------------------
    echo [错误] 核心依赖加载失败，已终止打包流程。
    echo 请向上滚动查看具体是哪个库缺失，修复后再运行此脚本。
    echo ----------------------------------------------------
    del env_test.py
    pause
    exit /b 1
)
del env_test.py

echo.
echo [4/4] 测试通过！开始执行 PyInstaller 打包程序 (OneDir 模式)...
python build_backend.py

echo.
echo ========================================
echo  打包流程结束！
echo  请检查你的 src-tauri/bin 目录下是否已生成文件。
echo ========================================
pause