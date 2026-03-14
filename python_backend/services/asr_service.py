import json
import os
import string
from models.schemas import SubtitleSegment, TranscribeRequest, WordTimestamp
from utils.audio_extractor import audio_extractor

class ASRService:
    """
    封装 Faster-Whisper 的推理引擎。
    """
    def __init__(self):
        self.current_model = None
        self.current_model_id = None
        self.last_detected_lang = "en"

    def unload_model(self):
        if self.current_model is not None:
            print(f"[ASR] 卸载模型释放显存: {self.current_model_id}")
            del self.current_model
            self.current_model = None
            self._cache_key = None
            import gc
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except:
                pass

    def load_model(self, model_id: str, device: str = "auto", compute_type: str = "default", on_progress=None):
        import ctranslate2
        import torch
        from faster_whisper import WhisperModel
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
            base_dir = os.environ.get('AISUBPLAYER_BASE_DIR', os.path.expanduser('~/.aisubplayer'))
            base_models_dir = os.path.join(base_dir, 'models')
            
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
                sliced_audio = os.path.join(tempfile.gettempdir(), f"sliced_resume_{os.path.basename(audio_path)}")
                try:
                    creationflags = 0
                    if os.name == 'nt':
                        creationflags = subprocess.CREATE_NO_WINDOW
                    subprocess.run(["ffmpeg", "-y", "-i", audio_path, "-ss", str(request.resume_offset), "-c", "copy", sliced_audio], check=True, capture_output=True, creationflags=creationflags)
                    audio_extractor.cleanup(audio_path)
                    audio_path = sliced_audio
                except Exception as e:
                    print(f"Resume slice failed: {e}")
            
            # 步骤 2: 读取词典配置 (放入 Initial Prompt 引导 Whisper 发音/术语纠正)
            prompt_parts = []
            
            # 强制输出简体中文的 Prompt 魔法
            if language == "zh" or getattr(request, 'target_language', '') == "zh":
                prompt_parts.append("以下是普通话的字幕，请输出简体中文。")
                
            if getattr(request, 'custom_glossary_path', None) and os.path.exists(request.custom_glossary_path):
                try:
                    with open(request.custom_glossary_path, 'r', encoding='utf-8') as f:
                        lines = f.read().splitlines()
                        if lines:
                            words = [ln.strip() for ln in lines if ln.strip()]
                            if words:
                                prompt_parts.append(", ".join(words))
                except Exception as e:
                    print(f"Failed loading glossary: {e}")
            
            initial_prompt = " ".join(prompt_parts) if prompt_parts else None

            import subprocess
            import numpy as np
            import torch
            from services.vad_service import vad_service
            
            _id = 1
            base_offset = request.resume_offset
            
            # 获取音频总时长用于控制滑动窗口边界
            total_duration = 0
            try:
                dur_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audio_path]
                dur_output = subprocess.check_output(dur_cmd, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                total_duration = float(dur_output.decode('utf-8').strip())
            except:
                pass

            TARGET_CHUNK = 300  # 基础切块时长(5分钟)
            BUFFER = 60         # 往后多读 60 秒用于寻找无声缝隙
            current_start = 0

            if on_progress:
                on_progress("正在预热 VAD 静音检测模型...")
            vad_service.load_model()
            get_speech_timestamps = vad_service.utils[0]

            while True:
                if total_duration > 0 and current_start >= total_duration:
                    break
                    
                # 计算本次要在内存中读取的跨度
                read_length = TARGET_CHUNK + BUFFER
                if total_duration > 0 and current_start + read_length > total_duration:
                    read_length = total_duration - current_start
                    
                if read_length <= 0:
                    break

                if on_progress:
                    on_progress(f"正在抽取时间段 {current_start // 60:.1f}分 - {(current_start + read_length) // 60:.1f}分 的音频至内存...")

                # 使用 FFmpeg 仅提取当前窗口时间段的音频到内存
                cmd = [
                    "ffmpeg", "-y", "-ss", str(current_start), "-t", str(read_length),
                    "-i", audio_path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"
                ]
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=creationflags)
                audio_bytes, _ = process.communicate()
                
                if not audio_bytes:
                    break
                    
                chunk_audio = np.frombuffer(audio_bytes, dtype=np.float32)
                actual_read_sec = len(chunk_audio) / 16000.0

                if actual_read_sec < 1.0:
                    break

                # 智能 VAD 断句切分 (只扫描当前加载到内存的这几分钟)
                if actual_read_sec <= TARGET_CHUNK:
                    safe_cut_sec = actual_read_sec
                else:
                    wav = torch.from_numpy(chunk_audio)
                    timestamps = get_speech_timestamps(wav, vad_service.model, sampling_rate=16000)
                    
                    valid_ends = [ts['end'] for ts in timestamps if ts['end'] < len(chunk_audio)]
                    best_cut_pts = None
                    for end_pts in valid_ends:
                        # 在 TARGET_CHUNK (300秒) 的附近寻找人声结束的停顿点
                        if end_pts > (TARGET_CHUNK - 120) * 16000:
                            best_cut_pts = end_pts + int(0.2 * 16000)  # 在人声结束后增加 0.2 秒的安全呼吸区
                    
                    if best_cut_pts and best_cut_pts < len(chunk_audio):
                        safe_cut_sec = best_cut_pts / 16000.0
                    else:
                        safe_cut_sec = TARGET_CHUNK  # 兜底：如果这段一直在持续说话没有停顿，就在 300 秒硬切

                # 截取最终安全长度的音频数组
                audio_slice = chunk_audio[:int(safe_cut_sec * 16000)]
                
                if on_progress:
                    on_progress(f"正在推理时间段 {current_start // 60:.1f}分 - {(current_start + safe_cut_sec) // 60:.1f}分 ...")

                try:
                    segments, info = model.transcribe(
                        audio_slice,
                        beam_size=5,
                        language=language,
                        vad_filter=request.vad_enabled,
                        vad_parameters=dict(min_silence_duration_ms=2000, speech_pad_ms=400) if request.vad_enabled else None,
                        word_timestamps=request.word_timestamps,
                        initial_prompt=initial_prompt
                    )
                    self.last_detected_lang = info.language
                except Exception as model_e:
                    raise RuntimeError(f"模型推理崩溃: {str(model_e)}")
                
                has_yielded = False
                for segment in segments:
                    has_yielded = True
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
                                words.append(WordTimestamp(
                                    start=w.start + base_offset + current_start, 
                                    end=w.end + base_offset + current_start, 
                                    word=wt
                                ))
                                
                    yield SubtitleSegment(
                        id=_id,
                        start_time=segment.start + base_offset + current_start,
                        end_time=segment.end + base_offset + current_start,
                        text=text,
                        original_text=None,
                        words=words if request.word_timestamps else None
                    )
                    _id += 1
                
                if not has_yielded:
                    print(f"[探针] 警告: 块 {current_start:.1f}-{current_start + safe_cut_sec:.1f} 无有效字幕产出", flush=True)

                # 将窗口起始点推进到安全切分的位置，进入下一次循环读取
                current_start += safe_cut_sec
                
        except Exception as e:
            import traceback
            err_msg = f"ASR Pipeline Error: {str(e)}\n{traceback.format_exc()}"
            print(err_msg)
            raise RuntimeError(err_msg)
        finally:
            if audio_path:
                try:
                    # 去掉局部 import，直接使用顶部已经导入的全局实例
                    audio_extractor.cleanup(audio_path)
                    print("[探针] 全局临时音频缓存已安全清理落盘。")
                except:
                    pass

    async def reidentify_segment(self, req: 'ReidentifyRequest'):
        """
        针对特定时间范围进行重新识别 (加入上下文 Padding 机制)。
        """
        import tempfile
        import subprocess
        from services.translation_service import translation_service
        
        model = self.load_model(req.model_id, req.inference_device, req.compute_type)
        
        audio_path = None
        temp_slice = None
        try:
            # 1. 提取完整音频（缓存中）
            audio_path = audio_extractor.extract_audio(req.video_path)
            
            # 2. 上下文扩展 (Padding)：前后各多截取 3 秒，提供语音上下文
            PAD_SEC = 3.0
            actual_start = max(0.0, req.start_time - PAD_SEC)
            actual_end = req.end_time + PAD_SEC
            duration = actual_end - actual_start
            
            # 3. 切割带上下文的目标片段
            temp_slice = os.path.join(tempfile.gettempdir(), f"reid_{os.path.basename(audio_path)}")
            cmd = [
                "ffmpeg", "-y", 
                "-ss", str(actual_start), 
                "-t", str(duration), 
                "-i", audio_path, 
                "-c", "pcm_s16le", "-ar", "16000", "-ac", "1", 
                temp_slice
            ]
            creationflags = 0
            if os.name == 'nt':
                creationflags = subprocess.CREATE_NO_WINDOW
            subprocess.run(cmd, check=True, capture_output=True, creationflags=creationflags)
            
            # 4. 推理 (开启 word_timestamps 以便精确过滤)
            language = req.source_language if req.source_language != "auto" else None
            
            # 同样应用繁体转简体的 Prompt
            prompt_parts = []
            if language == "zh" or getattr(req, 'target_language', '') == "zh":
                prompt_parts.append("以下是普通话的字幕，请输出简体中文。")
            initial_prompt = " ".join(prompt_parts) if prompt_parts else None

            segments, info = model.transcribe(
                temp_slice, 
                language=language, 
                beam_size=5, 
                word_timestamps=True,
                initial_prompt=initial_prompt
            )
            
            # 5. 精确裁剪：基于“词汇时间中点”来判定归属，防止吞字或重复上一句的结尾
            target_words = []
            fallback_text = []
            for s in segments:
                fallback_text.append(s.text.strip())
                if getattr(s, 'words', None):
                    for w in s.words:
                        # 计算该词在整个视频中的绝对时间
                        word_abs_start = actual_start + w.start
                        word_abs_end = actual_start + w.end
                        word_midpoint = (word_abs_start + word_abs_end) / 2.0
                        
                        # 核心逻辑：词语的“发音中点”必须落在用户请求的时间范围内才采纳
                        if req.start_time <= word_midpoint <= req.end_time:
                            # 注意：这里去掉了 .strip()，是为了保留 Whisper 原生吐出的英文前置空格
                            target_words.append(w.word)
            
            # 如果成功提取到精确词汇，合并且去除标点；否则使用 fallback
            if target_words:
                import string
                # 直接拼合，由于去掉了强行剔除空格的逻辑，英文单词之间能正常保留间距
                raw_text = "".join(target_words).strip()
                # 仅移除标点符号，不移除正常的空格
                all_text = raw_text.translate(str.maketrans('', '', string.punctuation + '，、。！？；：（）《》【】“”‘’'))
            else:
                all_text = " ".join(fallback_text)
            
            # 4. 翻译
            source_lang = info.language
            translated_text = None
            if req.target_language != "none" and req.target_language != source_lang:
                translated_text = translation_service.translate_segment(all_text, source_lang, req.target_language)
            
            return {
                "text": translated_text if translated_text else all_text,
                "original_text": all_text if translated_text else None
            }
            
        finally:
            if audio_path: audio_extractor.cleanup(audio_path)
            if temp_slice and os.path.exists(temp_slice): 
                try: os.remove(temp_slice)
                except: pass

asr_service = ASRService()
