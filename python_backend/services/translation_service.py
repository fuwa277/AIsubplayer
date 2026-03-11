class TranslationService:
    """
    接收 ASR 生成的文字进行多语言翻译。
    目前保留扩展骨架，可以接入内置轻型模型或第三方API
    """
    def __init__(self):
        pass
        
    def translate_segment(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        同步或异步进行文本翻译。
        返回翻译后的结果。
        """
        # 简单透接
        if target_lang == "none" or target_lang == source_lang:
            return text
            
        return f"[Translated to {target_lang}] {text}"

translation_service = TranslationService()
