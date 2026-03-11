import psutil
try:
    import pynvml
    pynvml.nvmlInit()
    HAS_NVML = True
except Exception:
    HAS_NVML = False

class SystemMonitor:
    def get_system_stats(self):
        cpu_usage = psutil.cpu_percent(interval=None)
        
        mem = psutil.virtual_memory()
        ram_usage = mem.used / mem.total * 100
        ram_total = mem.total / (1024 ** 3) # in GB
        ram_used_gb = mem.used / (1024 ** 3)
        
        gpu_stats = []
        if HAS_NVML:
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                name = pynvml.nvmlDeviceGetName(handle)
                
                vram_total = info.total / (1024 ** 3)
                vram_used = info.used / (1024 ** 3)
                vram_percent = (info.used / info.total) * 100
                gpu_usage = utilization.gpu
                
                gpu_stats.append({
                    "id": i,
                    "name": name,
                    "usage_percent": gpu_usage,
                    "vram_used_gb": vram_used,
                    "vram_total_gb": vram_total,
                    "vram_percent": vram_percent
                })
        
        import ctranslate2
        cuda_available = ctranslate2.get_cuda_device_count() > 0
        
        # ctranslate2 没有暴露设备名称接口，如果 pynvml 可用我们就用 pynvml，否则只显示受支持
        cuda_device_name = "NVIDIA (CTranslate2 支持)"
        if cuda_available and HAS_NVML and len(gpu_stats) > 0:
            cuda_device_name = gpu_stats[0]["name"]
            
        supported_types = []
        if cuda_available:
            try:
                supported_types = list(ctranslate2.get_supported_compute_types("cuda"))
            except Exception:
                pass
        
        return {
            "cpu_usage_percent": cpu_usage,
            "ram_used_gb": ram_used_gb,
            "ram_total_gb": ram_total,
            "ram_usage_percent": ram_usage,
            "gpus": gpu_stats,
            "cuda_support": {
                "available": cuda_available,
                "device_name": cuda_device_name,
                "supported_types": supported_types
            }
        }

system_monitor = SystemMonitor()
