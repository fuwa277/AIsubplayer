import asyncio
import json
from pydantic import BaseModel
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from models.schemas import TranscribeRequest, TranslateTextRequest, ReidentifyRequest
from services.asr_service import asr_service
from services.model_manager import model_manager
# 将 system_monitor 和 translation_service 改为局部延迟导入，避免启动时加载重型依赖导致假死

router = APIRouter()

# Store active websocket connections
active_connections = {}

@router.get("/health")
async def health_check():
    return {"status": "AISubPlayer active", "version": "1.0.0"}

@router.websocket("/ws/transcribe/{video_id}")
async def websocket_endpoint(websocket: WebSocket, video_id: str):
    """
    处理实时的字幕生成推流
    """
    await websocket.accept()
    active_connections[video_id] = websocket
    
    try:
        # 等待前端发送配置请求
        data = await websocket.receive_text()
        request_data = json.loads(data)
        req = TranscribeRequest(**request_data)
        
        print(f"[探针] 收到前端生成请求, req.resume_offset={req.resume_offset}", flush=True)
        
        # TODO: 验证模型是否就绪，若无则通知前端开始下载
        
        # 通知前端已经建连
        await websocket.send_text(json.dumps({
            "type": "progress",
            "message": "正在分配设备资源..."
        }))
        
        # 使用 asyncio.to_thread 防止阻塞 WebSocket 事件循环
        loop = asyncio.get_event_loop()
        
        # 为了让 transcribe_video 能发送状态回 websocket，我们传入一个 callback
        def progress_callback(msg):
            # to_thread 里我们不能直接 await send_text，可以通过 event loop thread-safe 发送
            asyncio.run_coroutine_threadsafe(
                websocket.send_text(json.dumps({
                    "type": "progress",
                    "message": msg
                })),
                loop
            )

        # 组装 SRT 文件路径（优先使用前端指定的轨道文件，实现“轨道容器论”）
        import os
        import re
        if getattr(req, 'target_srt_path', None):
            srt_path = req.target_srt_path
            print(f"[探针] 启用轨道容器模式，直接写入目标文件: {srt_path}", flush=True)
        else:
            v_dir = os.path.dirname(req.video_path)
            v_name = os.path.splitext(os.path.basename(req.video_path))[0]
            safe_model_id = re.sub(r'[\/\\:*?"<>|]', '-', req.model_id)
            srt_filename = f"{v_name}.{req.target_language if hasattr(req, 'target_language') else 'auto'}-AI-{safe_model_id}.srt"
            srt_path = os.path.join(v_dir, srt_filename)

        def format_srt_time(seconds):
            h = int(seconds // 3600)
            m = int((seconds % 3600) // 60)
            s = int(seconds % 60)
            ms = int((seconds % 1) * 1000)
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

        # 真正调用 Faster Whisper 翻译
        def generate_subtitles():
            for segment in asr_service.transcribe_video(req, on_progress=progress_callback):
                yield segment

        generator = generate_subtitles()
        
        import shutil
        chunk_idx = 1
        # 如果是断点续传，读取已有行数以继续编号，并使用追加模式
        if req.resume_offset > 0 and os.path.exists(srt_path):
            mode = "a"
            try:
                with open(srt_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    chunk_idx = content.count("-->") + 1
            except:
                pass
        else:
            mode = "w"
            # 第三道防线：如果从头生成，但文件已存在，执行自动备份策略防止误覆盖心血
            if os.path.exists(srt_path):
                try:
                    backup_path = srt_path + ".bak"
                    shutil.copy2(srt_path, backup_path)
                    print(f"[探针] 已存在旧字幕文件，已自动备份至: {backup_path}", flush=True)
                except Exception as e:
                    print(f"[探针] 自动备份失败: {e}", flush=True)

        # 写入初始化
        try:
            if mode == "w":
                with open(srt_path, "w", encoding="utf-8") as f:
                    pass
            elif mode == "a":
                with open(srt_path, "a", encoding="utf-8") as f:
                    f.write("\n\n")
        except Exception as file_e:
            print(f"[探针] 创建字幕文件失败: {file_e}", flush=True)

        is_aborted = False
        queue = asyncio.Queue()

        # 生产者：ASR 模型极速推理
        async def asr_producer():
            try:
                while True:
                    # 使用 asyncio.to_thread 防止阻塞事件循环
                    segment = await asyncio.to_thread(lambda: next(generator, None))
                    if segment is None:
                        await queue.put(None) # 结束信号
                        break
                    await queue.put(segment)
            except Exception as e:
                await queue.put(e)

        # 消费者：翻译流水线与异步磁盘 I/O
        async def translator_consumer():
            nonlocal chunk_idx, is_aborted
            
            def sync_write(seg, idx):
                with open(srt_path, "a", encoding="utf-8") as f:
                    f.write(f"{idx}\n")
                    f.write(f"{format_srt_time(seg.start_time)} --> {format_srt_time(seg.end_time)}\n")
                    if getattr(seg, 'original_text', None):
                        f.write(f"{seg.text}\n")
                        f.write(f"{seg.original_text}\n")
                    else:
                        f.write(f"{seg.text}\n")
                    f.write("\n")
                    f.flush()
                    os.fsync(f.fileno())

            try:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    if isinstance(item, Exception):
                        raise item

                    segment = item
                    
                    # 多语言翻译逻辑解耦 (仅在消费者中阻塞)
                    if req.target_language != "none":
                        from services.translation_service import translation_service
                        source_lang = req.source_language
                        if source_lang == "auto":
                            source_lang = getattr(asr_service, 'last_detected_lang', 'en')
                        
                        if req.target_language != source_lang:
                            original_text = segment.text
                            translated_text = await asyncio.to_thread(
                                translation_service.translate_segment, original_text, source_lang, req.target_language
                            )
                            segment.text = translated_text
                            segment.original_text = original_text

                    # 异步非阻塞磁盘落盘
                    await asyncio.to_thread(sync_write, segment, chunk_idx)
                    chunk_idx += 1

                    # 网络流发送
                    await websocket.send_text(json.dumps({
                        "type": "subtitle_chunk", 
                        "data": segment.model_dump()
                    }))
                    queue.task_done()
                    
            except Exception as e:
                if type(e).__name__ == "WebSocketDisconnect" or "Cannot call \"send\"" in str(e) or "close" in str(e).lower():
                    print("[探针] 客户端已主动断开连接，当前任务中止。", flush=True)
                    is_aborted = True
                else:
                    import traceback
                    err_detail = f"{str(e)}\n{traceback.format_exc()}"
                    print(f"[探针] 消费者管道发生异常:\n{err_detail}", flush=True)
                    try:
                        await websocket.send_text(json.dumps({"type": "error", "message": f"处理出错:\n{err_detail}"}))
                    except:
                        pass
                    is_aborted = True

        # 并发执行生产者-消费者流水线
        try:
            producer_task = asyncio.create_task(asr_producer())
            consumer_task = asyncio.create_task(translator_consumer())
            await asyncio.gather(producer_task, consumer_task)
        except Exception:
            pass
        
        if not is_aborted:
            print("[探针] 当前视频字幕处理流程结束，向前端发送 transcribe_done 信号", flush=True)
            try:
                await websocket.send_text(json.dumps({"type": "transcribe_done", "srt_path": srt_path}))
            except Exception:
                pass
            
    except WebSocketDisconnect:
        # 前端主动断开 / 中止任务
        print(f"Client disconnected for video {video_id}")
    finally:
        # 安全退出生成器，触发 asr_service 内部的 finally 删除临时音频块
        try:
            generator.close()
        except:
            pass

        if video_id in active_connections:
            del active_connections[video_id]
            
        # 多任务空闲检测：如果当前已没有任何排队或生成的任务，执行显存回收
        if len(active_connections) == 0:
            print("[内存管理] 队列已空闲，执行模型卸载与显存回收机制...")
            try:
                asr_service.unload_model()
                from services.translation_service import translation_service
                translation_service.unload_model()
            except Exception as gc_err:
                print(f"[内存管理] 卸载模型出错: {gc_err}")

@router.get("/models")
async def get_models():
    """获取本地和在线可用模型列表"""
    local = model_manager.list_local_models()
    return {
        "local_models": local,
        "download_status": model_manager.download_status,
        "supported_models": ["tiny", "base", "small", "medium", "large-v2", "large-v3", "large-v3-turbo", "nllb-600m"]
    }

@router.get("/models/status")
async def get_models_status():
    """前端轮询端点：获取本地模型列表和当前下载状态"""
    import os
    local = model_manager.list_local_models()
    engine_dir = os.path.join(model_manager.models_dir, 'cuda_engine')
    has_cuda_engine = os.path.exists(os.path.join(engine_dir, '.completed'))
    
    return {
        "local_models": local,
        "download_status": model_manager.download_status,
        "cuda_engine_ready": has_cuda_engine
    }

class ModelActionRequest(BaseModel):
    model_id: str

@router.post("/models/download")
async def api_download_model(req: ModelActionRequest):
    model_manager.download_model(req.model_id)
    return {"status": "started"}

@router.post("/models/pause")
async def api_pause_download(req: ModelActionRequest):
    model_manager.pause_download(req.model_id)
    return {"status": "paused"}

@router.post("/models/delete")
async def api_delete_model(req: ModelActionRequest):
    model_manager.delete_model(req.model_id)
    return {"status": "deleted"}

@router.post("/models/open_folder")
async def open_model_folder():
    model_manager.open_model_folder()
    return {"status": "ok"}

@router.post("/models/cuda/download")
async def api_download_cuda():
    model_manager.download_cuda_engine()
    return {"status": "started"}

@router.post("/models/cuda/pause")
async def api_pause_cuda():
    model_manager.pause_cuda_engine()
    return {"status": "paused"}

@router.post("/models/test_connection")
async def test_model_connection(req: ModelActionRequest):
    """测试与 HuggingFace 镜像的连接状态"""
    import asyncio
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, model_manager.test_connection, req.model_id)
    return result

def _isolated_run_test(queue, model_id, inference_device, compute_type, source_language):
    try:
        import numpy as np
        import traceback
        # 必须在子进程中重新导入以避免 pickling 错误和上下文冲突
        from services.asr_service import asr_service
        
        # 重新初始化并加载所需环境和模型
        model = asr_service.load_model(model_id, inference_device, compute_type)
        audio_data = np.zeros(16000, dtype=np.float32)
        lang = source_language if source_language != "auto" else "zh"
        
        # 触发前向空跑推理并等待结果
        segments, info = model.transcribe(audio_data, language=lang)
        list(segments)
        queue.put({"status": "success"})
    except Exception as e:
        import traceback
        queue.put({"status": "error", "message": f"{str(e)}\n{traceback.format_exc()}"})

@router.post("/test_inference")
async def api_test_inference(req: TranscribeRequest):
    import asyncio
    import multiprocessing
    import traceback

    try:
        ctx = multiprocessing.get_context("spawn")
        queue = ctx.Queue()
        
        p = ctx.Process(
            target=_isolated_run_test,
            args=(queue, req.model_id, req.inference_device, req.compute_type, req.source_language),
            daemon=True
        )
        p.start()

        # 等待子进程结果，如果在限定时间内不返回则被认为是挂起
        async def _wait_for_result():
            while p.is_alive():
                if not queue.empty():
                    return queue.get()
                await asyncio.sleep(0.5)
            # 子进程退出但没有排队内容
            if not queue.empty():
                return queue.get()
            return {"status": "error", "message": "子进程已意外结束，但未返回任何状态。"}

        try:
            # 15秒超时设置，避免主进程假死
            result = await asyncio.wait_for(_wait_for_result(), timeout=15.0)
            if result.get("status") == "success":
                return {
                    "status": "success", 
                    "message": f"引擎自检通过 ✓ (Device: {req.inference_device}, Compute: {req.compute_type})"
                }
            else:
                return {
                    "status": "error", 
                    "message": f"推理引擎挂载失败:\n{result.get('message')}"
                }
        except asyncio.TimeoutError:
            # 卡死说明库本身或设备不兼容导致彻底锁住(死锁)。此时只能结束进程。
            if p.is_alive():
                p.terminate()
                p.join(timeout=1.0)
                if p.is_alive():
                    p.kill()

            return {
                "status": "error", 
                "message": (
                    f"⚠️ 推理引擎超时卡死 (已强制终止)。\n\n"
                    f"可能原因：在您当前的 GPU 或驱动上，不支持目前的计算精度（例：不支持 '{req.compute_type}' 或缺少特定 DLL 核心库）。\n"
                    f"建议操作：\n1. 将 Compute Type (计算精度) 切换为 'float32' 并重试。\n2. 检查您的 NVIDIA 显卡驱动是否需要更新。"
                )
            }
            
    except Exception as e:
        return {
            "status": "error", 
            "message": f"启动自检进程失败: {str(e)}\n{traceback.format_exc()}"
        }

# 已知的下载源列表
DOWNLOAD_SOURCES = [
    {"id": "hf-mirror", "name": "HF Mirror", "desc": "中国大陆推荐", "endpoint": "https://hf-mirror.com"},
    {"id": "aliendao", "name": "AlienDAO", "desc": "备用镜像", "endpoint": "https://aliendao.cn"},
    {"id": "huggingface", "name": "HuggingFace 官方", "desc": "海外用户", "endpoint": "https://huggingface.co"},
]

@router.get("/models/sources")
async def get_download_sources():
    """获取可用下载源列表及当前选中源"""
    import os
    return {
        "sources": DOWNLOAD_SOURCES,
        "current": os.environ.get("HF_ENDPOINT", "https://hf-mirror.com"),
    }

@router.post("/models/test_sources")
async def test_all_sources():
    """并发测试所有下载源的连通性，返回各源延迟"""
    import asyncio, socket, time

    def test_one(endpoint: str) -> dict:
        host = endpoint.replace("https://", "").replace("http://", "").split("/")[0]
        start = time.time()
        try:
            conn = socket.create_connection((host, 443), timeout=6)
            conn.close()
            latency = int((time.time() - start) * 1000)
            return {"ok": True, "latency_ms": latency}
        except Exception as e:
            return {"ok": False, "error": str(e)[:60]}

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, test_one, src["endpoint"])
        for src in DOWNLOAD_SOURCES
    ]
    results = await asyncio.gather(*tasks)
    return {
        "results": [
            {**src, **result}
            for src, result in zip(DOWNLOAD_SOURCES, results)
        ]
    }

class SetSourceRequest(BaseModel):
    endpoint: str

@router.post("/models/set_source")
async def set_download_source(req: SetSourceRequest):
    """切换下载源（运行时动态修改 HF_ENDPOINT）"""
    import os
    os.environ["HF_ENDPOINT"] = req.endpoint
    import huggingface_hub.constants as hf_consts
    hf_consts.ENDPOINT = req.endpoint
    model_manager.HF_ENDPOINT = req.endpoint
    return {"ok": True, "endpoint": req.endpoint}



@router.get("/system/stats")
async def get_system_stats():
    """获取底层系统监控数据"""
    from services.system_monitor import system_monitor
    return system_monitor.get_system_stats()

@router.post("/translate")
async def translate_text(req: TranslateTextRequest):
    """独立的直接翻译文本通道"""
    from services.translation_service import translation_service
    result = translation_service.translate_segment(req.text, req.source_language, req.target_language)
    return {"text": result}

def get_settings_path():
    import os
    # 动态获取全局配置的绿色便携目录，不再写死C盘
    base_dir = os.environ.get('AISUBPLAYER_BASE_DIR', os.path.expanduser("~/.aisubplayer"))
    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, "settings.json")

@router.post("/settings/save")
async def save_settings(req: dict):
    import os
    try:
        path = get_settings_path()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(req, f, ensure_ascii=False, indent=2)
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/settings/load")
async def load_settings():
    import os
    path = get_settings_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

@router.post("/reidentify")
async def api_reidentify_segment(req: ReidentifyRequest):
    """
    针对单句字幕片段进行重新识别和翻译。
    """
    try:
        result = await asr_service.reidentify_segment(req)
        return result
    except Exception as e:
        import traceback
        return {"error": f"{str(e)}\n{traceback.format_exc()}"}

@router.post("/shutdown")
async def shutdown_backend():

    """安全退出后端进程"""
    import os
    os._exit(0)
    return {"status": "shutting down"}
