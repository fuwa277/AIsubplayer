import os
import sys
import threading
import shutil
import time
import json
import urllib.request
import urllib.error
import ssl

# HuggingFace 镜像 - 中国大陆可用
# 必须用 setdefault 真正写入 os.environ，hf_hub_download 才会读到这个值
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
HF_ENDPOINT = os.environ['HF_ENDPOINT']

# 跳过不需要的文件格式
SKIP_PATTERNS = ('flax_model', 'tf_model', '.h5', 'rust_model', 'onnx', '.msgpack')

CHUNK_SIZE = 512 * 1024  # 512KB per chunk

def _make_ssl_context():
    """创建 SSL context，使用 certifi 证书（PyInstaller 打包后必须用这个才能正常 HTTPS）"""
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
        return ctx
    except ImportError:
        pass
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()

SSL_CONTEXT = _make_ssl_context()

class ModelManager:
    """
    负责 Faster-Whisper 模型的下载、卸载、加载状态管理。
    - 自定义 urllib 下载器，支持 HTTP Range 请求（真正的断点续传）
    - 每 512KB chunk 检查暂停信号（随时响应暂停）
    - 文件保存至 models/{model_id}/ 扁平目录，faster-whisper 可直接加载
    - 使用 hf-mirror.com 镜像解决中国大陆访问问题
    """
    def __init__(self, models_dir: str = "models"):
        self.models_dir = os.path.abspath(models_dir)
        if not os.path.exists(self.models_dir):
            os.makedirs(self.models_dir)
            
        self.HF_ENDPOINT = HF_ENDPOINT

        self.download_status = {}
        self._stop_events = {}

    REPO_MAP = {
        "tiny":           "Systran/faster-whisper-tiny",
        "base":           "Systran/faster-whisper-base",
        "small":          "Systran/faster-whisper-small",
        "medium":         "Systran/faster-whisper-medium",
        "large-v2":       "Systran/faster-whisper-large-v2",
        "large-v3":       "Systran/faster-whisper-large-v3",
        "large-v3-turbo": "deepdml/faster-whisper-large-v3-turbo-ct2",
    }

    def get_repo_id(self, model_id: str) -> str:
        return self.REPO_MAP.get(model_id, f"Systran/faster-whisper-{model_id}")

    def get_model_path(self, model_id: str) -> str:
        """本地模型保存路径"""
        return os.path.join(self.models_dir, model_id)

    def list_local_models(self) -> list:
        """返回已完整下载的模型 ID 列表"""
        result = []
        if not os.path.exists(self.models_dir):
            return result
        for name in os.listdir(self.models_dir):
            path = os.path.join(self.models_dir, name)
            if not os.path.isdir(path): continue
            if os.path.exists(os.path.join(path, '.completed')):
                result.append(name)
            elif os.path.exists(os.path.join(path, 'config.json')) and (os.path.exists(os.path.join(path, 'model.bin')) or os.path.exists(os.path.join(path, 'model.safetensors'))):
                # 兼容旧版本下载的
                with open(os.path.join(path, '.completed'), 'w') as f: f.write('done')
                result.append(name)
        return result

    def open_model_folder(self):
        import subprocess
        try:
            if os.name == 'nt':
                os.startfile(self.models_dir)
            elif sys.platform == 'darwin':
                subprocess.call(['open', self.models_dir])
            else:
                subprocess.call(['xdg-open', self.models_dir])
        except Exception as e:
            print(f"Failed to open model folder: {e}")

    def _make_request(self, url: str, extra_headers: dict = None) -> urllib.request.Request:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AISubPlayer/1.0',
        }
        if extra_headers:
            headers.update(extra_headers)
        return urllib.request.Request(url, headers=headers)

    def test_connection(self, model_id: str) -> dict:
        """测试与 HuggingFace 镜像的网络连通性（socket TCP + HTTP 双层测试）"""
        import socket as _socket
        host = HF_ENDPOINT.replace('https://', '').replace('http://', '').split('/')[0]
        port = 443
        url = f"{HF_ENDPOINT}/api/models/{self.get_repo_id(model_id)}"

        # 第一层：socket TCP 连通性（不走 SSL，绕过代理和 urllib 问题）
        try:
            conn = _socket.create_connection((host, port), timeout=8)
            conn.close()
            tcp_ok = True
        except Exception as e:
            tcp_ok = False
            tcp_err = str(e)

        if not tcp_ok:
            # 尝试 80 端口（HTTP）
            try:
                conn = _socket.create_connection((host, 80), timeout=8)
                conn.close()
                tcp_ok = True
            except Exception:
                return {"ok": False, "url": url, "error": f"TCP 连接失败: {tcp_err}"}

        # 第二层：HTTP 请求验证（排除 DNS 劫持等）
        req = self._make_request(url)
        for ctx in [SSL_CONTEXT, None]:
            try:
                kwargs = {"timeout": 8}
                if ctx is not None:
                    kwargs["context"] = ctx
                else:
                    import ssl as _ssl
                    kwargs["context"] = _ssl._create_unverified_context()
                with urllib.request.urlopen(req, **kwargs) as resp:
                    return {"ok": True, "url": url, "endpoint": HF_ENDPOINT}
            except urllib.error.HTTPError as e:
                return {"ok": e.code < 500, "url": url, "error": f"HTTP {e.code}"}
            except Exception:
                continue

        # TCP 通但 HTTP 失败（可能是防火墙深度包检测，但基础连通性 OK）
        return {"ok": True, "url": url, "endpoint": HF_ENDPOINT, "note": "TCP OK, HTTPS blocked"}

    def _get_file_list(self, repo_id: str) -> list:
        """通过 HF API 获取需要下载的文件列表"""
        from huggingface_hub import list_repo_files
        import huggingface_hub.constants as hf_consts
        hf_consts.ENDPOINT = HF_ENDPOINT
        
        all_files = list_repo_files(repo_id)
        files = [
            f for f in all_files
            if not any(pat in f for pat in SKIP_PATTERNS)
        ]
        return files

    def _download_file(self, url: str, dest_path: str,
                       stop_event: threading.Event,
                       on_progress) -> bool:
        """
        下载单个文件，支持 HTTP Range 续传。
        每下载 CHUNK_SIZE 字节检查一次 stop_event。
        返回 True=完成, False=被暂停
        """
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        existing = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0

        headers = {}
        if existing > 0:
            headers['Range'] = f'bytes={existing}-'

        req = self._make_request(url, headers)
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as resp:
                content_length = int(resp.headers.get('Content-Length', 0))
                total = existing + content_length

                mode = 'ab' if existing > 0 else 'wb'
                downloaded = existing
                t0 = time.time()
                last_bytes = existing

                with open(dest_path, mode) as f:
                    while True:
                        if stop_event.is_set():
                            return False  # 被暂停，文件保留在磁盘等待续传

                        chunk = resp.read(CHUNK_SIZE)
                        if not chunk:
                            break

                        f.write(chunk)
                        downloaded += len(chunk)

                        # 计算速度
                        elapsed = time.time() - t0
                        if elapsed >= 0.5:
                            speed = (downloaded - last_bytes) / elapsed
                            last_bytes = downloaded
                            t0 = time.time()
                        else:
                            speed = 0

                        on_progress(downloaded, total, speed)

        except urllib.error.HTTPError as e:
            if e.code == 416:
                # Range Not Satisfiable - 文件已经完整
                return True
            raise

        return True

    def _download_thread(self, model_id: str, repo_id: str, stop_event: threading.Event):
        status = self.download_status[model_id]
        model_path = self.get_model_path(model_id)
        os.makedirs(model_path, exist_ok=True)

        try:
            # 第一步：通过 API 获取文件列表
            status['speed'] = '获取文件列表...'
            files = self._get_file_list(repo_id)

            if not files:
                status['error'] = '未找到可下载的文件'
                status['downloading'] = False
                return

            # 过滤已经下载完成的文件（支持续传）
            pending = [f for f in files
                       if not (os.path.exists(os.path.join(model_path, f))
                               and os.path.getsize(os.path.join(model_path, f)) > 0)]
            total_files = len(files)
            already_done = total_files - len(pending)

            for i, filename in enumerate(pending):
                if stop_event.is_set():
                    status['downloading'] = False
                    status['speed'] = '已暂停（可续传）'
                    return

                def _progress_cb(down, tot, spd):
                    completed_so_far = already_done + i
                    pct = ((completed_so_far + (down / tot if tot > 0 else 0)) / total_files) * 100
                    status['progress'] = pct
                    
                    if spd > 1024 * 1024:
                        spd_str = f"{spd/1024/1024:.2f} MB/s"
                    else:
                        spd_str = f"{spd/1024:.0f} KB/s"
                    status['speed'] = f'下载 {filename.split("/")[-1]} ... {spd_str}'

                try:
                    url = f"{HF_ENDPOINT}/{repo_id}/resolve/main/{filename}"
                    dest = os.path.join(model_path, filename)
                    success = self._download_file(url, dest, stop_event, _progress_cb)
                    if not success:
                        status['downloading'] = False
                        status['speed'] = '已暂停（可续传）'
                        return

                except Exception as file_err:
                    import traceback
                    full_trace = traceback.format_exc()
                    if stop_event.is_set():
                        status['downloading'] = False
                        status['speed'] = '已暂停（可续传）'
                        return
                    err_msg = str(file_err)
                    print(f"[ModelManager] Failed {filename}: {err_msg}\n{full_trace}", flush=True)
                    try:
                        with open(os.path.expanduser('~/aisubplayer_error.log'), 'a', encoding='utf-8') as f:
                            f.write(f"--- ERROR DOWNLOADING {filename} ---\n{full_trace}\n\n")
                    except: pass
                    
                    status['error'] = f"详见用户目录aisubplayer_error.log: {err_msg[:60]}"
                    status['downloading'] = False
                    return  # 出错时停止整个下载以便用户看到错误

            if not stop_event.is_set():
                with open(os.path.join(model_path, '.completed'), 'w') as f:
                    f.write('done')
                status['progress'] = 100.0
                status['speed'] = '下载完成 ✓'
                status['downloading'] = False
            else:
                status['downloading'] = False
                status['speed'] = '已暂停（可续传）'

        except Exception as e:
            import traceback
            full_trace = traceback.format_exc()
            err = str(e)
            print(f"[ModelManager] Download error for {model_id}:\n{full_trace}", flush=True)
            try:
                with open(os.path.expanduser('~/aisubplayer_error.log'), 'a', encoding='utf-8') as f:
                    f.write(f"--- GENERAL ERROR DOWNLOADING {model_id} ---\n{full_trace}\n\n")
            except: pass
            
            if not stop_event.is_set():
                status['error'] = f"详见 aisubplayer_error.log: {err[:60]}"
                status['speed'] = '下载失败'
            status['downloading'] = False

    def download_model(self, model_id: str):
        if self.download_status.get(model_id, {}).get('downloading'):
            return

        stop_event = threading.Event()
        self._stop_events[model_id] = stop_event

        prev_progress = self.download_status.get(model_id, {}).get('progress', 0.0)
        self.download_status[model_id] = {
            'progress': prev_progress,
            'speed': '连接中...',
            'downloading': True,
            'error': None,
        }

        repo_id = self.get_repo_id(model_id)
        t = threading.Thread(
            target=self._download_thread,
            args=(model_id, repo_id, stop_event),
            daemon=True,
        )
        t.start()

    def pause_download(self, model_id: str):
        """暂停（当前 chunk 传完后立刻停止）"""
        if model_id in self._stop_events:
            self._stop_events[model_id].set()
        if model_id in self.download_status:
            self.download_status[model_id]['downloading'] = False
            self.download_status[model_id]['speed'] = '暂停中...'

    def delete_model(self, model_id: str):
        path = self.get_model_path(model_id)
        if os.path.exists(path):
            try:
                shutil.rmtree(path)
            except Exception as e:
                print(f"[ModelManager] Delete failed for {model_id}: {e}")

    # ================== CUDA DLL 下载引擎 ==================
    def download_cuda_engine(self):
        if self.download_status.get('cuda_engine', {}).get('downloading'):
            return

        stop_event = threading.Event()
        self._stop_events['cuda_engine'] = stop_event

        self.download_status['cuda_engine'] = {
            'progress': self.download_status.get('cuda_engine', {}).get('progress', 0.0),
            'speed': '连接中...',
            'downloading': True,
            'error': None,
        }

        t = threading.Thread(
            target=self._download_cuda_thread,
            args=(stop_event,),
            daemon=True,
        )
        t.start()

    def pause_cuda_engine(self):
        if 'cuda_engine' in self._stop_events:
            self._stop_events['cuda_engine'].set()
        if 'cuda_engine' in self.download_status:
            self.download_status['cuda_engine']['downloading'] = False
            self.download_status['cuda_engine']['speed'] = '暂停中...'

    def _download_cuda_thread(self, stop_event: threading.Event):
        status = self.download_status['cuda_engine']
        engine_dir = os.path.join(self.models_dir, 'cuda_engine')
        os.makedirs(engine_dir, exist_ok=True)

        def download_and_extract(pkg_name, url):
            whl_path = os.path.join(engine_dir, f"{pkg_name}.whl")
            
            def _progress_cb(down, tot, spd):
                pct = (down / tot * 100) if tot > 0 else 0
                spd_str = f"{spd/1024/1024:.2f} MB/s" if spd > 1024*1024 else f"{spd/1024:.0f} KB/s"
                if pkg_name == 'CUDA_CUBLAS_12':
                    status['progress'] = pct * 0.35
                else:
                    status['progress'] = 35.0 + (pct * 0.65)
                status['speed'] = f'拉取 {pkg_name}... {spd_str}'
                
            success = self._download_file(url, whl_path, stop_event, _progress_cb)
            if not success or stop_event.is_set():
                return False
                
            status['speed'] = f'正在高速解压 DLL 到主进程... ({pkg_name})'
            import zipfile
            with zipfile.ZipFile(whl_path, 'r') as zf:
                for member in zf.namelist():
                    if member.endswith('.dll'):
                        filename = os.path.basename(member)
                        target_path = os.path.join(engine_dir, filename)
                        with zf.open(member) as source, open(target_path, "wb") as target:
                            shutil.copyfileobj(source, target)
            os.remove(whl_path)
            with open(os.path.join(engine_dir, f".{pkg_name}_completed"), 'w') as f:
                f.write('done')
            return True

        try:
            status['speed'] = '获取 NVIDIA官方 PyPI 源索引...'
            import json
            
            cublas_done = os.path.exists(os.path.join(engine_dir, ".CUDA_CUBLAS_12_completed"))
            if not cublas_done:
                req1 = self._make_request('https://pypi.org/pypi/nvidia-cublas-cu12/json')
                with urllib.request.urlopen(req1, timeout=10, context=SSL_CONTEXT) as resp:
                    cublas_urls = json.loads(resp.read())['urls']
                cublas_url = next(u['url'] for u in cublas_urls if 'win_amd64' in u['filename'])
                if not download_and_extract('CUDA_CUBLAS_12', cublas_url):
                    status['downloading'] = False
                    status['speed'] = '已暂停'
                    return

            cudnn_done = os.path.exists(os.path.join(engine_dir, ".CUDA_CUDNN_12_completed"))
            if not cudnn_done:
                req2 = self._make_request('https://pypi.org/pypi/nvidia-cudnn-cu12/json')
                with urllib.request.urlopen(req2, timeout=10, context=SSL_CONTEXT) as resp:
                    cudnn_urls = json.loads(resp.read())['urls']
                cudnn_url = next(u['url'] for u in cudnn_urls if 'win_amd64' in u['filename'])
                if not download_and_extract('CUDA_CUDNN_12', cudnn_url):
                    status['downloading'] = False
                    status['speed'] = '已暂停'
                    return
                
            with open(os.path.join(engine_dir, '.completed'), 'w') as f:
                f.write('done')
            status['progress'] = 100.0
            status['speed'] = 'CUDA 依赖下载并布署完成 ✓ (请重启应用)'
            status['downloading'] = False

        except Exception as e:
            import traceback
            print(f"[ModelManager] CUDA Download error:\n{traceback.format_exc()}", flush=True)
            if not stop_event.is_set():
                status['error'] = f"下载引擎失败: {str(e)[:60]}"
                status['speed'] = '下载挂起'
            status['downloading'] = False

import os
base_models_dir = os.path.join(os.path.expanduser('~/.aisubplayer'), 'models')
model_manager = ModelManager(base_models_dir)
