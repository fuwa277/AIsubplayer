import { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VolumeX, Volume1, Volume2 } from 'lucide-react';
import { VideoPlayer } from "./components/VideoPlayer";
import { ControlBar } from "./components/ControlBar";
import { Sidebar } from "./components/Sidebar";
import { SubtitleOverlay } from "./components/SubtitleOverlay";
import { SettingsModal } from "./components/SettingsModal";
import { useSettingsStore } from "./stores/settingsStore";
import { usePlayerStore } from "./stores/playerStore";
import { useQueueStore, VideoItem } from "./stores/queueStore";
import { useLogStore } from "./stores/logStore";
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from "@tauri-apps/api/core";

import { generateId } from "./utils";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sidebarOpen, theme, bgColor, accentColor } = useSettingsStore();
  const { volume, isMuted, setVolume, toggleMute } = usePlayerStore();

  const [volumeOSD, setVolumeOSD] = useState<number | null>(null);
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll wheel to adjust volume over video area
  const handleVideoWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    if (newVol === 0 && !isMuted) toggleMute();
    else if (newVol > 0 && isMuted) toggleMute();
    setVolume(newVol);
    // Show OSD
    setVolumeOSD(Math.round(newVol * 100));
    if (osdTimer.current) clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setVolumeOSD(null), 1200);
  }, [volume, isMuted, setVolume, toggleMute]);

  // Apply background color to body
  useEffect(() => {
    document.body.style.backgroundColor = bgColor;
  }, [bgColor]);

  // Tauri V2 Native Drag & Drop (配合 dragDropEnabled: true)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupDragDrop = async () => {
      try {
        // Tauri V2 默认通过 tauri://drag-drop 派发带有物理路径的拖放事件
        unlisten = await listen<any>('tauri://drag-drop', (event) => {
          const payload = event.payload;
          const paths = payload.paths || payload;
          if (!paths || !Array.isArray(paths)) return;

          const state = useQueueStore.getState();
          const targetQueueId = state.activeQueueId || (state.queues.length > 0 ? state.queues[0].id : 'default');
          const activeQueue = state.queues.find(q => q.id === targetQueueId);

          paths.forEach(async (p: string) => {
            const name = p.split(/[/\\]/).pop() || 'Unknown';
            if (/\.(mp4|mkv|avi|mov|webm|flv|wmv)$/i.test(name)) {
              if (activeQueue) {
                const existingIndex = activeQueue.items.findIndex(v => v.path === p);
                if (existingIndex !== -1) {
                  state.setActiveVideoIndex(existingIndex);
                  return;
                }
              }

              const videoId = generateId();
              const webPath = convertFileSrc(p);
              const video: VideoItem = {
                id: videoId,
                name: name.replace(/\.[^.]+$/, ''),
                path: p,
                webPath: webPath,
                duration: 0,
                subtitleStatus: 'none',
                subtitleProgress: 0,
              };
              state.addVideo(targetQueueId, video);
              
              const tempVid = document.createElement('video');
              tempVid.preload = 'metadata';
              tempVid.src = webPath;
              tempVid.onloadedmetadata = () => {
                 useQueueStore.getState().updateVideoDuration(videoId, tempVid.duration);
              };
            }
          });
        });
      } catch (err) {
        console.error("Drag-drop setup failed:", err);
      }
    };
    setupDragDrop();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // 监听播放列表切换，如果切回了记忆过的视频，自动空降到历史播放时间点
  useEffect(() => {
    return useQueueStore.subscribe((state, prevState) => {
        const currentVideo = state.queues.find(q => q.id === state.activeQueueId)?.items[state.activeVideoIndex];
        const prevVideo = prevState.queues.find(q => q.id === prevState.activeQueueId)?.items[prevState.activeVideoIndex];
        
        if (currentVideo?.id !== prevVideo?.id && currentVideo && videoRef.current) {
            const handleLoaded = () => {
                if (currentVideo.currentTime && videoRef.current) {
                    videoRef.current.currentTime = currentVideo.currentTime;
                }
            };
            videoRef.current.addEventListener('loadedmetadata', handleLoaded, { once: true });
        }
    });
  }, []);

  // 每 1 秒钟保存一次当前播放进度，实现按秒精准记忆
  useEffect(() => {
    const interval = setInterval(() => {
       if (videoRef.current && !videoRef.current.paused) {
           const state = useQueueStore.getState();
           const activeVideo = state.getActiveVideo();
           if (activeVideo && videoRef.current.currentTime > 0) {
               state.updateVideoTime(activeVideo.id, videoRef.current.currentTime);
           }
       }
    }, 1000);
    return () => clearInterval(interval);
  }, []);


  // Prevent default context menu globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Global Backend Logger
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupLogger = async () => {
      try {
        unlisten = await listen<string>('backend-log', (event) => {
          useLogStore.getState().addLog(event.payload);
        });
        const unlistenCrash = await listen<string>('backend-crashed', (err) => {
          useLogStore.getState().setBackendCrashed(true);
          useLogStore.getState().addLog(`\n[FATAL] AI 核心引擎已意外崩溃/闪退！详细原因请拉到上方查看 Python 堆栈 (exit payload: ${err.payload})`);
          alert('致命错误：AI 后端守护进程已异常终止（存在严重兼容问题或运行库缺失）！请前往「应用设置」最下方的运行日志面板排查。');
        });
        return () => { if (unlisten) unlisten(); unlistenCrash(); };
      } catch (err) { }
    };
    setupLogger();
  }, []);

  return (
    <div className={`w-full h-screen flex overflow-hidden ${theme}`}>
      {/* Global CSS Vars */}
      <style>
        {`
          :root {
            --user-accent: ${accentColor};
            --user-accent-hover: ${accentColor}cc;
          }
        `}
      </style>
      {/* Main Video Area - wheel event for volume control */}
      <div
        className="flex-1 relative min-w-0 flex flex-col bg-black"
        onWheel={handleVideoWheel}
      >
        {/* The active video player */}
        <VideoPlayer videoRef={videoRef} />

        {/* Subtitles rendered over the video */}
        <SubtitleOverlay />

        {/* Volume OSD overlay */}
        <AnimatePresence>
          {volumeOSD !== null && (
            <motion.div
              key="vol-osd"
              initial={{ opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="absolute top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
            >
              <div className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl bg-black/60 backdrop-blur-sm border border-white/10 shadow-xl">
                <div className="flex items-center gap-2">
                  {volumeOSD === 0
                    ? <VolumeX className="w-5 h-5 text-white/80" />
                    : volumeOSD < 50
                      ? <Volume1 className="w-5 h-5 text-white/80" />
                      : <Volume2 className="w-5 h-5 text-white/80" />}
                  <span className="text-white font-semibold text-lg tabular-nums w-12 text-right">
                    {volumeOSD}%
                  </span>
                </div>
                <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-100"
                    style={{ width: `${volumeOSD}%` }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom hover control bar */}
        <ControlBar
          videoRef={videoRef}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Right Sidebar (Collapsible) */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex-shrink-0 bg-[var(--color-bg-secondary)] border-l border-[var(--color-border)] z-40 relative"
          >
            {/* The actual width is controlled by the parent motion.div, but inner content needs a fixed width to prevent wrapping during animation */}
            <div className="w-[320px] h-full absolute inset-0">
              <Sidebar videoRef={videoRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal (Overlay) */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            isOpen={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
