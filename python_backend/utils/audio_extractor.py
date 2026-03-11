import subprocess
import os
import uuid

class AudioExtractor:
    def __init__(self, cache_dir: str = "audio_cache"):
        self.cache_dir = cache_dir
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir, exist_ok=True)
            
    def extract_audio(self, video_path: str) -> str:
        """
        利用 FFmpeg 从视频中提取 16kHz 的单声道 WAV 音频，以最佳匹配 Whisper 和 Silero-VAD
        """
        print(f"Extracting Audio for {video_path}")
        
        # 简单生成唯一缓存名，如果存在也可以通过 md5 哈希等来做命中
        filename = f"{uuid.uuid4().hex}.wav"
        output_path = os.path.join(self.cache_dir, filename)
        
        # FFmpeg 命令:
        # -y (覆盖)
        # -i (输入)
        # -vn (无视频)
        # -ac 1 (单声道)
        # -ar 16000 (16kHz采样率)
        # -acodec pcm_s16le (16位PCM)
        try:
            cmd = [
                "ffmpeg", "-y", "-i", video_path, 
                "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", 
                output_path
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return output_path
        except subprocess.CalledProcessError as e:
            print(f"FFmpeg extraction failed: {e}")
            raise RuntimeError(f"FFmpeg extraction failed for {video_path}")
            
    def cleanup(self, audio_path: str):
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception as e:
                print(f"Failed to cleanup {audio_path}: {e}")

audio_extractor = AudioExtractor()
