import json
import os
import torch
import string
from faster_whisper import WhisperModel
from models.schemas import SubtitleSegment, TranscribeRequest, WordTimestamp
from utils.audio_extractor import audio_extractor

class ASRService:
    """
    封装 Faster-Whisper 的推理引擎。
    """
    def __init__(self):
        self.current_model = None
        self.current_model_id = None

    def load_model(self, model_id: str, device: str = "auto", compute_type: str = "default", on_progress=None):
        import ctranslate2
        has_cuda = ctranslate2.get_cuda_device_count() > 0
        actual_device = "cuda" if has_cuda and device in ["auto", "cuda", "gpu"] else "cpu"
        
        # 处理 compute_type
        # ctranslate2 会自动处理 default，但在报错时直接抛出让外层捕获，从而提示下载依赖
        if compute_type == "default":
            # 让引擎自行决定，我们只在 UI 层负责检测报错并指引下载
            actual_compute_type = "default"
        else:
            actual_compute_type = compute_type
        
        print(f"[ASR] load_model: {model_id} | device={actual_device} | compute_type={actual_compute_type} (requested={compute_type})")
        
        # 缓存检测：同时匹配 model_id 和 compute_type，避免切换精度后复用错误的旧模型
        cache_key = f"{model_id}::{actual_device}::{actual_compute_type}"
        if getattr(self, '_cache_key', None) == cache_key and self.current_model is not None:
            if on_progress:
                on_progress(f"使用已缓存的模型实例 ({actual_device}/{actual_compute_type})...")
            return self.current_model
        
        try:
            import os
            base_models_dir = os.path.join(os.path.expanduser('~/.aisubplayer'), 'models')
            
            # 优先使用我们自己下载的本地模型（~/.aisubplayer/models/{model_id}/）
            local_path = os.path.join(base_models_dir, model_id)
            if os.path.isdir(local_path) and os.path.exists(os.path.join(local_path, "config.json")):
                model_source = local_path
                print(f"[ASR] Using local model at: {local_path}")
            else:
                # 降级到 HF 自动下载（开发环境或缺失时）
                model_source = model_id
                print(f"[ASR] Local model not found, downloading: {model_id}")
            
            if on_progress:
                device_name = "GPU (CUDA)" if actual_device == "cuda" else "CPU"
                on_progress(f"正在配置并在 {device_name} 上加载 AI 模型 (首次加载/切换模型需1-3分钟编译，请耐心等待)...")

            self.current_model = WhisperModel(
                model_source,
                device=actual_device,
                compute_type=actual_compute_type,
                download_root=base_models_dir,
            )
            self._cache_key = cache_key
            self.current_model_id = model_id
            return self.current_model
        except Exception as e:
            print(f"Failed to load Whisper model: {e}")
            raise e

    def transcribe_video(self, request: TranscribeRequest, on_progress=None):
        """
        生成器函数，按句 Yield 字幕结果。
        """
        model = self.load_model(request.model_id, request.inference_device, request.compute_type, on_progress)
        
        language = request.source_language if request.source_language != "auto" else None
        
        audio_path = None
        
        try:
            # 步骤 1: 提取纯净音频
            if on_progress:
                on_progress("正在抽取视频的音轨...")
            audio_path = audio_extractor.extract_audio(request.video_path)
            
            # --- 断点续传：跳过已经识别过的音频 ---
            if request.resume_offset > 0:
                if on_progress:
                    on_progress(f"检测到断点，正在跳过前 {request.resume_offset:.1f} 秒音频...")
                import tempfile
                import subprocess
                import os
                sliced_audio = os.path.join(tempfile.gettempdir(), f"sliced_resume_{os.path.basename(audio_path)}")
                try:
                    subprocess.run(["ffmpeg", "-y", "-i", audio_path, "-ss", str(request.resume_offset), "-c", "copy", sliced_audio], check=True, capture_output=True)
                    audio_extractor.cleanup(audio_path)
                    audio_path = sliced_audio
                except Exception as e:
                    print(f"Resume slice failed: {e}")
            
            # 步骤 2: Optional 人声分离及更严苛的 VAD 可以安插在此刻处理 audio_path
            
            # 读取词典配置 (放入 Initial Prompt 引导 Whisper 发音/术语纠正)
            initial_prompt = None
            if request.custom_glossary_path and os.path.exists(request.custom_glossary_path):
                try:
                    with open(request.custom_glossary_path, 'r', encoding='utf-8') as f:
                        lines = f.read().splitlines()
                        # Whisper prompts typically work best as a comma-separated list of rare words
                        if lines:
                            words = [ln.strip() for ln in lines if ln.strip()]
                            initial_prompt = ", ".join(words)
                except Exception as e:
                    print(f"Failed loading glossary: {e}")

            # 步骤 3: 喂给 faster-whisper 执行转录 (采用分块处理以极速响应)
            print(f"Starting actual transcription on audio trace, using glossary: {bool(initial_prompt)}")
            if on_progress:
                on_progress("音频提取完毕，开始分块并行推理...")
            
            import tempfile
            import subprocess
            
            # 获取总时长
            total_duration = 0
            try:
                dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audio_path]
                total_duration = float(subprocess.check_output(dur_cmd).decode('utf-8').strip())
            except:
                pass # 获取失败则fallback

            import re
            
            TARGET_CHUNK = 300  # 目标基础切块时长(5分钟)
            BUFFER = 60         # 往后多找60秒寻找静音点
            current_start = 0
            _id = 1
            
            # 如果断点续传处理过 audio_path，那么这里的 current_start 从 0 算起，因为传给它的 audio 已经是切好的
            # base_offset 才是真实时间轴的偏移
            base_offset = request.resume_offset
            
            def get_smart_cut_length(start_t):
                # 剩余时间不足以组成一个完整的块时，直接返回剩余时间
                if total_duration > 0 and start_t + TARGET_CHUNK >= total_duration:
                    return total_duration - start_t
                
                # 截取 [start_t, start_t + TARGET_CHUNK + BUFFER] 进行快速静音检测 (-ss放前面极速定位)
                cmd = [
                    "ffmpeg", "-y", "-ss", str(start_t), "-t", str(TARGET_CHUNK + BUFFER),
                    "-i", audio_path,
                    "-af", "silencedetect=noise=-30dB:d=0.5",
                    "-f", "null", "-"
                ]
                try:
                    # Windows 下 ffmpeg 可能会因为编码导致输出报错，指定 errors='ignore' 增强鲁棒性
                    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
                    
                    # 如果 ffmpeg 运行失败，这里能看到原因
                    if result.returncode != 0:
                        print(f"[ASR Error] FFmpeg silencedetect failed: {result.stderr}")
                    
                    silences = []
                    for line in result.stderr.split('\n'):
                        if "silence_start:" in line:
                            match = re.search(r"silence_start:\s+([\d\.]+)", line)
                            if match:
                                silences.append(float(match.group(1)))
                    
                    # 寻找位于这几分钟内的静音点。
                    # 为了不让切块变得太碎，我们只取时间 > (TARGET_CHUNK - 120 秒) 的静音点
                    valid_silences = [s for s in silences if s > (TARGET_CHUNK - 120)]
                    if valid_silences:
                        # 选最后那个最符合条件的静音点，加上 0.2 秒的余量，确保它切在断句的“呼吸间隙”中
                        best_len = valid_silences[-1] + 0.2
                        # 兜底防御：确保这个值是合理的（防止算出来是负数或者死循环）
                        if best_len > 60 and best_len < (TARGET_CHUNK + BUFFER):
                            return best_len
                except Exception as e:
                    print(f"Silence detect failed: {e}")
                    
                # 如果找不到合适的静音点，或者发生了任何异常，回退到生硬地切成 300 秒
                return TARGET_CHUNK
            
            while True:
                if total_duration > 0 and current_start >= total_duration:
                    break
                    
                # 动态计算本次切块的具体时长（智能寻找无声段落）
                chunk_length = get_smart_cut_length(current_start)
                
                chunk_file = os.path.join(tempfile.gettempdir(), f"chunk_{current_start}_{os.path.basename(audio_path)}")
                
                # 开始切割，注意 -ss 依然在前以保证极高的切割速度
                slice_cmd = ["ffmpeg", "-y", "-ss", str(current_start), "-t", str(chunk_length), "-i", audio_path, "-c", "copy", chunk_file]
                try:
                    # 去掉 capture_output 以便在控制台看到 ffmpeg 的原生输出
                    subprocess.run(slice_cmd, check=True)
                except Exception as e:
                    print(f"Chunk slice failed or EOF: {e}")
                    # 如果是由于 ffmpeg 找不到导致崩溃，这里会报错
                    break
                    
                # 检查切出的文件是否有效（大小>0）
                if not os.path.exists(chunk_file) or os.path.getsize(chunk_file) < 1000:
                    break
                
                if on_progress:
                    on_progress(f"正在推理时间段 {current_start // 60:.1f}分 - {(current_start + chunk_length) // 60:.1f}分 ...")

                segments, info = model.transcribe(
                    chunk_file,
                    beam_size=5,
                    language=language,
                    vad_filter=request.vad_enabled,
                    vad_parameters=dict(min_silence_duration_ms=500) if request.vad_enabled else None,
                    word_timestamps=request.word_timestamps,
                    initial_prompt=initial_prompt
                )
                
                for segment in segments:
                    text = segment.text.strip()
                    if request.remove_punctuation:
                        text = text.translate(str.maketrans('', '', string.punctuation + '，、。！？；：（）《》【】“”‘’'))
                        
                    words = []
                    if request.word_timestamps and getattr(segment, 'words', None):
                        for w in segment.words:
                            wt = w.word.strip()
                            if request.remove_punctuation:
                                wt = wt.translate(str.maketrans('', '', string.punctuation + '，、。！？；：（）《》【】“”‘’'))
                            if wt:
                                words.append(WordTimestamp(start=w.start + base_offset + current_start, end=w.end + base_offset + current_start, word=wt))
                                
                    yield SubtitleSegment(
                        id=_id,
                        start_time=segment.start + base_offset + current_start,
                        end_time=segment.end + base_offset + current_start,
                        text=text,
                        original_text=None,
                        words=words if request.word_timestamps else None
                    )
                    _id += 1
                
                try:
                    os.remove(chunk_file)
                except:
                    pass
                    
                # 进度往前推进这一块的实际时间
                current_start += chunk_length
                
        except Exception as e:
            print(f"ASR Pipeline Error: {e}")
            raise e
        finally:
            if audio_path:
                audio_extractor.cleanup(audio_path)

asr_service = ASRService()
