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
                on_progress(f"正在配置并在 {device_name} 上加载 AI 模型 (该过程可能需要较长时间)...")

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

            # 步骤 3: 喂给 faster-whisper 执行转录
            print(f"Starting actual transcription on audio trace, using glossary: {bool(initial_prompt)}")
            if on_progress:
                on_progress("模型分析中...")
            
            segments, info = model.transcribe(
                audio_path,
                beam_size=5,
                language=language,
                vad_filter=request.vad_enabled,
                vad_parameters=dict(min_silence_duration_ms=500) if request.vad_enabled else None,
                word_timestamps=request.word_timestamps,
                initial_prompt=initial_prompt
            )
            
            _id = 1
            for segment in segments:
                text = segment.text.strip()
                if request.remove_punctuation:
                    # 去除常见中英文标点符号
                    text = text.translate(str.maketrans('', '', string.punctuation + '，、。！？；：（）《》【】“”‘’'))
                    
                words = []
                if request.word_timestamps and getattr(segment, 'words', None):
                    for w in segment.words:
                        wt = w.word.strip()
                        if request.remove_punctuation:
                            wt = wt.translate(str.maketrans('', '', string.punctuation + '，、。！？；：（）《》【】“”‘’'))
                        if wt:
                            words.append(WordTimestamp(start=w.start, end=w.end, word=wt))
                            
                yield SubtitleSegment(
                    id=_id,
                    start_time=segment.start,
                    end_time=segment.end,
                    text=text,
                    original_text=None,
                    words=words if request.word_timestamps else None
                )
                _id += 1
                
        except Exception as e:
            print(f"ASR Pipeline Error: {e}")
            raise e
        finally:
            if audio_path:
                audio_extractor.cleanup(audio_path)

asr_service = ASRService()
