from pydantic import BaseModel
from typing import Optional, List

class WordTimestamp(BaseModel):
    start: float
    end: float
    word: str

class SubtitleSegment(BaseModel):
    id: int
    start_time: float
    end_time: float
    text: str
    original_text: Optional[str] = None
    words: Optional[List[WordTimestamp]] = None
    
class TranscribeRequest(BaseModel):
    video_path: str
    model_id: str
    source_language: str = "auto"
    target_language: str = "none"
    vad_enabled: bool = True
    vocal_isolation_enabled: bool = False
    custom_glossary_path: Optional[str] = None
    inference_device: str = "auto"
    compute_type: str = "default"
    batch_size: int = 16
    batch_length: int = 30
    max_segment_length: int = 40
    word_timestamps: bool = True
    remove_punctuation: bool = False
    resume_offset: float = 0.0
    target_srt_path: Optional[str] = None

class TranslateTextRequest(BaseModel):
    text: str
    source_language: str
    target_language: str

class ReidentifyRequest(BaseModel):
    video_path: str
    start_time: float
    end_time: float
    model_id: str
    inference_device: str = "auto"
    compute_type: str = "default"
    source_language: str = "auto"
    target_language: str = "none"

