import PyInstaller.__main__
import os
import shutil

if __name__ == '__main__':
    print("Starting PyInstaller build...")
    PyInstaller.__main__.run([
        'main.py',
        '--name=aisubplayer-backend',
        '--onedir', # Use onedir for fast startup
        '--noconfirm', # Skip confirm prompts
        '--noconsole',

        '--hidden-import=uvicorn',
        '--hidden-import=fastapi',
        '--hidden-import=faster_whisper',
        '--hidden-import=ctranslate2',
        '--hidden-import=websockets',
        '--hidden-import=pydantic',
        '--hidden-import=pynvml',
        '--hidden-import=transformers',
        '--hidden-import=api.routes',
        '--hidden-import=services.asr_service',
        '--hidden-import=services.model_manager',
        '--hidden-import=services.system_monitor',
        '--hidden-import=services.translation_service',
        '--hidden-import=services.vad_service',
        '--hidden-import=services.vocal_isolation',
        '--hidden-import=models.schemas',
        '--collect-all=faster_whisper',
        '--collect-all=ctranslate2',
        '--collect-all=tokenizers',
        '--collect-all=uvicorn',
        '--collect-all=fastapi',
        '--collect-submodules=api',
        '--collect-submodules=services',
        '--collect-submodules=models',
    ])

    print("Build complete. Moving to Tauri bin folder...")
    # Tauri sidecar bin directory path
    target_dir = os.path.join("..", "src-tauri", "bin", "aisubplayer-backend-x86_64-pc-windows-msvc")
    
    # Ensure the target directory is clean and exists
    if os.path.exists(target_dir):
        shutil.rmtree(target_dir)
    os.makedirs(target_dir, exist_ok=True)
    
    src_dir = os.path.join("dist", "aisubplayer-backend")
    if os.path.exists(src_dir):
        # 将 onedir 下的所有文件拷贝到 target_dir
        for item in os.listdir(src_dir):
            s = os.path.join(src_dir, item)
            d = os.path.join(target_dir, item)
            if os.path.isdir(s):
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)
        
        # 为了符合 Tauri sidecar 的命名识别，我们确保入口 exe 存在
        # 该入口 exe 现在是一个几百 KB 的 Rust 转发器，不再是 500MB 的单一文件
        sidecar_exe = os.path.join("..", "src-tauri", "bin", "aisubplayer-backend-x86_64-pc-windows-msvc.exe")
        shim_source = os.path.join("..", "src-tauri", "bin", "sidecar_shim.rs")
        
        if not os.path.exists(sidecar_exe) and os.path.exists(shim_source):
            print("Sidecar entry missing, attempting to compile Rust shim...")
            import subprocess
            subprocess.run(["rustc", shim_source, "-o", sidecar_exe], check=True)
        
        print(f"Successfully packaged and moved backend folder to {target_dir}")
        print(f"Sidecar entry check passed: {sidecar_exe}")
    else:
        print("Build failed: could not find dist/aisubplayer-backend")



