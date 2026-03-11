import PyInstaller.__main__
import os
import shutil

if __name__ == '__main__':
    print("Starting PyInstaller build...")
    PyInstaller.__main__.run([
        'main.py',
        '--name=aisubplayer-backend',
        '--onefile',
        '--hidden-import=uvicorn',
        '--hidden-import=fastapi',
        '--hidden-import=faster_whisper',
        '--hidden-import=ctranslate2',
        '--hidden-import=websockets',
        '--hidden-import=pydantic',
        '--collect-all=faster_whisper',
        '--collect-all=ctranslate2',
        '--collect-all=tokenizers',
        '--collect-all=uvicorn',
        '--collect-all=fastapi',
    ])

    print("Build complete. Moving to Tauri bin folder...")
    # Tauri expects the sidecar bin to be named with the target triple
    output_bin = os.path.join("..", "src-tauri", "bin", "aisubplayer-backend-x86_64-pc-windows-msvc.exe")
    
    # Ensure the target directory exists
    os.makedirs(os.path.dirname(output_bin), exist_ok=True)
    
    src_exe = os.path.join("dist", "aisubplayer-backend.exe")
    if os.path.exists(src_exe):
        shutil.copy2(src_exe, output_bin)
        print(f"Successfully packaged and moved executable to {output_bin}")
    else:
        print("Build failed: could not find dist/aisubplayer-backend.exe")
