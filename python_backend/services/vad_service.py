import torch

class VADService:
    """
    提供高精度的 Silero VAD 静音切分
    """
    def __init__(self):
        self.model = None
        self.utils = None
        self.is_loaded = False

    def load_model(self):
        if self.is_loaded:
            return
        
        print("Loading Silero VAD model...")
        # device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        # silero 最好在 CPU 保持常驻，消耗极低
        self.model, self.utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True
        )
        self.is_loaded = True
        
    def process_audio(self, audio_path: str):
        self.load_model()
        (get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks) = self.utils
        
        # 加载音频并获取有人声的时间戳数组
        wav = read_audio(audio_path, sampling_rate=16000)
        speech_timestamps = get_speech_timestamps(wav, self.model, sampling_rate=16000)
        
        return speech_timestamps

vad_service = VADService()
