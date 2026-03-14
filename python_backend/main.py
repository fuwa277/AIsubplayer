import os
import sys
import io

# 修复 PyInstaller 在 --noconsole 模式下 sys.stdout 为 None 导致 uvicorn 崩溃的问题
if getattr(sys, 'stdout', None) is None:
    sys.stdout = io.StringIO()
if getattr(sys, 'stderr', None) is None:
    sys.stderr = io.StringIO()

# ================= 读取自定义模型路径与缓存配置 =================
import json
import sys

# 1. 自动定位当前运行目录并注入 sys.path (终极物理映射法)
if getattr(sys, 'frozen', False):
    app_path = os.path.abspath(os.path.dirname(sys.executable))
    # 强制将 exe 所在目录加入环境变量，让程序直接读取旁边的物理代码文件夹
    if app_path not in sys.path:
        sys.path.insert(0, app_path)
else:
    app_path = os.getcwd()

custom_base_dir = os.path.join(app_path, '.aisubplayer_data')

# 2. 权限探测与智能回退机制 (兼容绿色版和 C:\Program Files 安装版)
try:
    os.makedirs(custom_base_dir, exist_ok=True)
    # 尝试写入一个隐藏的测试文件，验证是否真的有写入权限
    _test_file = os.path.join(custom_base_dir, '.write_test')
    with open(_test_file, 'w') as f:
        f.write('ok')
    os.remove(_test_file)
except (PermissionError, OSError):
    # 如果没有权限（例如被安装到了 C:\Program Files），则回退到当前用户的个人文件夹
    # 路径通常为：C:\Users\用户名\.aisubplayer_data
    fallback_path = os.path.expanduser('~')
    custom_base_dir = os.path.join(fallback_path, '.aisubplayer_data')
    os.makedirs(custom_base_dir, exist_ok=True)

# 设置全局环境变量，后续所有模块都会自动读取这个最终安全的路径
os.environ['AISUBPLAYER_BASE_DIR'] = custom_base_dir
os.environ['HF_HOME'] = os.path.join(custom_base_dir, 'hf_cache')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

# 强制控制台使用 UTF-8 输出，解决日志里的中文视觉乱码
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
# ========================================================

# ================= 优先挂载外部 CUDA 运行库 =================
# CTranslate2 / Faster-Whisper 等底层依赖需要 cublas 和 cudnn DLL 文件
# 修复：指向新的绿色便携目录，正确加载显卡加速核心
cuda_engine_dir = os.path.join(custom_base_dir, 'models', 'cuda_engine')
if os.path.exists(cuda_engine_dir):
    os.environ['PATH'] = cuda_engine_dir + os.pathsep + os.environ.get('PATH', '')
    try:
        if hasattr(os, 'add_dll_directory'):
            os.add_dll_directory(cuda_engine_dir)
            print(f"[Core] C++ CUDA Engine runtime injected from: {cuda_engine_dir}")
    except Exception as e:
        print(f"[Core] Warning: Failed to inject DLL directory {e}")
# ========================================================

# ================= 高级性能调优环境变量 =================
# 1. 解决 Windows 下多线程/OpenMP 冲突导致的严重死锁 (假死)
os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

# 2. 规避 PyTorch 首次加载大语言模型时 cuDNN benchmark 的漫长预热挂起
os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
# ========================================================

# 必须在所有 huggingface_hub 相关导入之前设置，否则它会在模块初始化时缓存默认 endpoint
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
os.environ.setdefault('HUGGINGFACE_HUB_VERBOSITY', 'warning')

# hf_hub_download 内部使用 requests 库，requests 读 REQUESTS_CA_BUNDLE / CURL_CA_BUNDLE 获取 CA 证书
# PyInstaller 打包的 exe 里没有系统 CA bundle，必须手动指向 certifi 的 cacert.pem
# 否则 requests 会 SSL 验证失败，被服务器当作异常请求返回 401
try:
    import certifi as _certifi
    _ca_bundle = _certifi.where()
    os.environ.setdefault('REQUESTS_CA_BUNDLE', _ca_bundle)
    os.environ.setdefault('CURL_CA_BUNDLE', _ca_bundle)
except Exception:
    pass


import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import routes
import os
import sys
import socket
import threading
import time
import psutil

app = FastAPI(
    title="AISubPlayer Backend",
    description="Backend API for AI Subtitle Player using Faster-Whisper",
    version="1.0.0"
)

# Enable CORS for Tauri frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(routes.router, prefix="/api")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "AISubPlayer API is running"}


def kill_old_backend_on_port(port: int):
    """强制释放端口上的旧 backend 进程，确保使用固定端口"""
    import subprocess
    try:
        if os.name == 'nt':
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
            for line in out.strip().split('\n'):
                if 'LISTENING' in line:
                    pid = int(line.strip().split()[-1])
                    if pid and pid != os.getpid():
                        try:
                            proc = psutil.Process(pid)
                            if 'aisubplayer' in proc.name().lower() or 'python' in proc.name().lower():
                                print(f"[AISubPlayer] Killing old backend on port {port}, PID={pid}", flush=True)
                                proc.kill()
                                time.sleep(0.5)
                        except Exception:
                            pass
        else:
            for conn in psutil.net_connections(kind='inet'):
                if conn.laddr.port == port and conn.pid and conn.pid != os.getpid():
                    try:
                        proc = psutil.Process(conn.pid)
                        if 'aisubplayer' in proc.name().lower() or 'python' in proc.name().lower():
                            print(f"[AISubPlayer] Killing old backend on port {port}, PID={conn.pid}", flush=True)
                            proc.kill()
                            time.sleep(0.5)
                    except Exception:
                        pass
    except Exception:
        pass


def parent_watcher(watch_pid: int):
    """监视指定 PID，当它消失时自动退出。
    watch_pid 优先使用命令行传入的 Tauri 进程 PID（--parent-pid 参数），
    fallback 到 os.getppid()。
    """
    print(f"[AISubPlayer] Watching parent PID={watch_pid}", flush=True)
    while True:
        try:
            if not psutil.pid_exists(watch_pid):
                print(f"[AISubPlayer] Parent PID={watch_pid} gone, exiting.", flush=True)
                os._exit(0)
            # 额外检查：进程存在但已是 zombie/dead
            try:
                p = psutil.Process(watch_pid)
                if p.status() == psutil.STATUS_ZOMBIE:
                    os._exit(0)
            except psutil.NoSuchProcess:
                os._exit(0)
        except Exception:
            pass
        time.sleep(2)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()

    # 旧的子进程下载模式（保留兼容）
    if len(sys.argv) >= 4 and sys.argv[1] == "--download-model":
        repo_id = sys.argv[2]
        cache_dir = sys.argv[3]
        from huggingface_hub import snapshot_download
        try:
            snapshot_download(repo_id, cache_dir=cache_dir)
            print("PROGRESS:100.0:完成", flush=True)
        except Exception as e:
            print(f"ERROR:{str(e)}", flush=True)
        sys.exit(0)

    # 从命令行获取 Tauri 父进程 PID（Tauri sidecar 启动时传入 --parent-pid <pid>）
    parent_pid = None
    for i, arg in enumerate(sys.argv):
        if arg == "--parent-pid" and i + 1 < len(sys.argv):
            try:
                parent_pid = int(sys.argv[i + 1])
            except ValueError:
                pass
    if parent_pid is None:
        parent_pid = os.getppid()

    # 启动 parent watcher 守护线程
    watcher = threading.Thread(target=parent_watcher, args=(parent_pid,), daemon=True)
    watcher.start()

    # 固定端口 8005（不再自动跳端口），先杀掉旧实例再绑定
    env_port = os.environ.get("PORT")
    port = int(env_port) if env_port else 8005
    kill_old_backend_on_port(port)

    print(f"[AISubPlayer] Starting backend on port {port}, watching PID={parent_pid}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
