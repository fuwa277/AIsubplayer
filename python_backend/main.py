import os
import sys

# ================= 优先挂载外部 CUDA 运行库 =================
# CTranslate2 / Faster-Whisper 等底层依赖需要 cublas 和 cudnn DLL 文件
cuda_engine_dir = os.path.join(os.path.expanduser('~/.aisubplayer'), 'models', 'cuda_engine')
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
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.pid and conn.pid != os.getpid():
                try:
                    proc = psutil.Process(conn.pid)
                    # 只杀同名进程，避免误杀系统进程
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
