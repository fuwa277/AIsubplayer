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

            // Spawn sidecar immediately – no artificial delay now that port is pre-cleared
            tauri::async_runtime::spawn(async move {
                let sidecar_command = app_handle
                    .shell()
                    .sidecar("aisubplayer-backend")
                    .expect("failed to create sidecar command")
                    .args(["--parent-pid", &tauri_pid.to_string()]);

                let (mut rx, child) = match sidecar_command.spawn() {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[Backend] Failed to spawn: {}", e);
                        return;
                    }
                };
                let _child = child;

                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let msg = String::from_utf8_lossy(&line).to_string();
                            println!("[Backend] {}", msg);
                            let _ = app_handle.emit("backend-log", msg);
                        }
                        CommandEvent::Stderr(line) => {
                            let msg = String::from_utf8_lossy(&line).to_string();
                            eprintln!("[Backend Warn] {}", msg);
                            let _ = app_handle.emit("backend-log", msg);
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[Backend Crash] {}", err);
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[Backend Terminated] {:?}", payload);
                            let _ = app_handle.emit("backend-crashed", format!("{:?}", payload));
                        }
                        _ => {}
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
