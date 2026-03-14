// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::Emitter;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn kill_old_backends() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "aisubplayer-backend.exe", "/FI", "MEMUSAGE gt 0"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Kill old backends BEFORE building the Tauri app so port 8005 is free when setup() runs.
    // This is fast (~50ms) so it's fine to block here.
    kill_old_backends();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            let tauri_pid = std::process::id();
            let app_handle = app.handle().clone();

            // 使用原生 Rust 进程启动代替 Tauri Sidecar
            tauri::async_runtime::spawn(async move {
                #[cfg(target_os = "windows")]
                use std::os::windows::process::CommandExt;

                let mut cmd = std::process::Command::new("./aisubplayer-backend/aisubplayer-backend.exe");
                cmd.args(["--parent-pid", &tauri_pid.to_string()]);

                #[cfg(target_os = "windows")]
                cmd.creation_flags(0x08000000); // 隐藏黑框

                match cmd.spawn() {
                    Ok(_) => {
                        println!("[Backend] 成功通过原生方式拉起外部后端！");
                        let _ = app_handle.emit("backend-log", "✅ 后端已成功启动！(原生模式下不再捕获详细日志以节省性能)".to_string());
                    }
                    Err(e) => {
                        eprintln!("[Backend] Failed to spawn: {}", e);
                        let _ = app_handle.emit("backend-log", format!("❌ 启动后端失败，请检查 aisubplayer-backend 文件夹是否和主程序在同一目录: {}", e));
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                kill_old_backends();
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
