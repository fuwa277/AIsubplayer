class TranslationService:
    """
    接收 ASR 生成的文字进行多语言翻译。
    内置搭载 CTranslate2 的 NLLB 模型互译。
    """
    def __init__(self):
        self.translator = None
        self.tokenizer = None
        self.current_model = None
        
        # NLLB ISO codes mapping
        self.lang_map = {
            "en": "eng_Latn",
            "zh": "zho_Hans",
            "ja": "jpn_Jpan",
            "ko": "kor_Hang",
            "fr": "fra_Latn",
            "de": "deu_Latn",
            "es": "spa_Latn",
            "ru": "rus_Cyrl",
            "ar": "arb_Arab"
        }

    def unload_model(self):
        if self.translator is not None:
            print(f"[翻译] 卸载 NLLB 模型释放显存: {self.current_model}")
            del self.translator
            del self.tokenizer
            self.translator = None
            self.tokenizer = None
            self.current_model = None
            import gc
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except:
                pass

    def load_model(self):
        import os
        from services.model_manager import model_manager
        model_id = "nllb-600m"
        model_path = model_manager.get_model_path(model_id)
        
        if not os.path.exists(os.path.join(model_path, "config.json")):
            raise RuntimeError(f"翻译语言模型 {model_id} 尚未挂载，请前往模型仓库中下载以启用离线翻译功能。")
            
        if self.translator is None or self.current_model != model_id:
            import ctranslate2
            import transformers
            has_cuda = ctranslate2.get_cuda_device_count() > 0
            device = "cuda" if has_cuda else "cpu"
            print(f"[翻译] 加载 NLLB 模型至 {device}...")
            self.translator = ctranslate2.Translator(model_path, device=device)
            self.tokenizer = transformers.AutoTokenizer.from_pretrained(model_path)
            self.current_model = model_id
        
    def translate_segment(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        同步进行文字翻译。
        返回翻译后的结果。
        """
        if target_lang == "none" or target_lang == source_lang or not text.strip():
            return text
            
        try:
            self.load_model()
            
            src_code = self.lang_map.get(source_lang, "eng_Latn")
            tgt_code = self.lang_map.get(target_lang, "zho_Hans")
            
            self.tokenizer.src_lang = src_code
            source = self.tokenizer.convert_ids_to_tokens(self.tokenizer.encode(text))
            
            target_prefix = [tgt_code]
            results = self.translator.translate_batch([source], target_prefix=[target_prefix])
            
            target = results[0].hypotheses[0][1:]
            translated_text = self.tokenizer.decode(self.tokenizer.convert_tokens_to_ids(target))
            return translated_text
        except Exception as e:
            import traceback
            print(f"[翻译] 失败: {e}\n{traceback.format_exc()}")
            return text

translation_service = TranslationService()

