import React, { useRef, useEffect, useCallback } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useQueueStore } from '../stores/queueStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { parseSrt } from '../services/srtParser';
import { motion, AnimatePresence } from 'framer-motion';
import { Pause } from 'lucide-react';
import { readDir } from '@tauri-apps/plugin-fs';

interface VideoPlayerProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoRef }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        isPlaying, volume, isMuted, setPlaying, togglePlay,
        setCurrentTime, setDuration, isFastForwarding, setFastForwarding,
        playbackRate
    } = usePlayerStore();
    const { getActiveVideo } = useQueueStore();
    const activeVideo = getActiveVideo();

    const fastForwardRef = useRef(false);
    const fastForwardInterval = useRef<number | null>(null);

    // Sync video element with store
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onTimeUpdate = () => setCurrentTime(video.currentTime);
        const onDurationChange = () => setDuration(video.duration);
        const onPlay = () => setPlaying(true);
        const saveCurrentProgress = () => {
            if (activeVideo?.id && video.currentTime > 0) {
                usePlayerStore.getState().saveProgress(activeVideo.id, video.currentTime);
            }
        };
        const onPause = () => { setPlaying(false); saveCurrentProgress(); };
        const onEnded = () => {
            setPlaying(false);
            saveCurrentProgress();
            const { playNext } = useQueueStore.getState();
            playNext();
        };
        const onLoadedMetadata = () => {
            if (activeVideo?.id) {
                const savedProgress = usePlayerStore.getState().getProgress(activeVideo.id);
                // 留出1秒余量防止直接跳到最后结束
                if (savedProgress > 0 && savedProgress < video.duration - 1) {
                    video.currentTime = savedProgress;
                }
            }
        };

        const onBeforeUnload = () => saveCurrentProgress();

        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('durationchange', onDurationChange);
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('ended', onEnded);
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        window.addEventListener('beforeunload', onBeforeUnload);

        return () => {
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('durationchange', onDurationChange);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            window.removeEventListener('beforeunload', onBeforeUnload);
            saveCurrentProgress(); // 卸载或切换时保存进度
        };
    }, [videoRef, activeVideo?.id]);

    // Volume sync
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = isMuted ? 0 : volume;
    }, [volume, isMuted, videoRef]);

    // Playback rate sync
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (!isFastForwarding) {
            video.playbackRate = playbackRate;
        }
    }, [playbackRate, isFastForwarding, videoRef]);

    // Play/pause sync
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !video.src) return;
        if (isPlaying) {
            video.play().catch(() => { });
        } else {
            video.pause();
        }
    }, [isPlaying, videoRef]);

    // Auto-load subtitle when active video or subtitle track changes
    useEffect(() => {
        const loadSubtitles = async () => {
            const subStore = useSubtitleStore.getState();

            if (!activeVideo) {
                subStore.clearCues();
                return;
            }

            // 如果正在生成中，不要从本地频繁加载覆盖内存，以免打断推流和引发数据冲突
            if (activeVideo.subtitleStatus === 'generating') {
                return;
            }

            let targetSrtPath: string | null = null;
            let currentTrackId = activeVideo.activeSubtitleId || `auto-${activeVideo.id}`;

            // 1. 优先尝试加载用户明确选中的字幕轨道
            if (activeVideo.activeSubtitleId) {
                const activeTrack = activeVideo.subtitles?.find(s => s.id === activeVideo.activeSubtitleId);
                if (activeTrack && activeTrack.path) {
                    targetSrtPath = activeTrack.path;
                }
            }

            // 2. 如果没有显式激活的字幕，尝试智能探测后台自动生成的 SRT 文件
            if (!targetSrtPath && activeVideo.path) {
                console.log("[前端探针] 开始探测本地字幕，视频路径:", activeVideo.path);
                try {
                    // 安全分离目录和文件名
                    const lastSlashIndex = Math.max(activeVideo.path.lastIndexOf('/'), activeVideo.path.lastIndexOf('\\'));
                    const dirPath = lastSlashIndex >= 0 ? activeVideo.path.substring(0, lastSlashIndex) : '';
                    const fileName = lastSlashIndex >= 0 ? activeVideo.path.substring(lastSlashIndex + 1) : activeVideo.path;
                    const baseName = fileName.replace(/\.[^/.]+$/, ""); // 例如 "04.头骨结构"

                    console.log("[前端探针] 解析目录:", dirPath, "| 基础文件名:", baseName);

                    if (dirPath) {
                        const entries = await readDir(dirPath);
                        console.log(`[前端探针] 读取目录成功，共扫描到 ${entries.length} 个文件`);
                        
                        // 模糊匹配：只要是以该视频名开头，且是 .srt 结尾的，一律抓取回来，无视模型和语言代号
                        const srtEntry = entries.find(e => {
                            if (!e.name) return false;
                            const isMatch = e.name.startsWith(baseName) && e.name.endsWith('.srt');
                            if (isMatch) console.log(`[前端探针] 找到潜在匹配项: ${e.name}`);
                            return isMatch;
                        });

                        if (srtEntry) {
                            targetSrtPath = `${dirPath}/${srtEntry.name}`;
                            console.log("[前端探针] 最终决定加载目标字幕文件:", targetSrtPath);
                        } else {
                            console.log("[前端探针] 目录中未找到任何匹配的 .srt 文件");
                        }
                    }
                } catch (err) {
                    console.error("[前端探针] 探测本地字幕目录失败:", err);
                }
            }

            if (targetSrtPath) {
                console.log("[前端探针] 准备调用 parseSrt 解析文件:", targetSrtPath);
                try {
                    const cues = await parseSrt(targetSrtPath, currentTrackId);
                    console.log(`[前端探针] parseSrt 解析成功，共获得字幕条数: ${cues.length}`);
                    subStore.setCues(cues);
                } catch (e) {
                    console.error("[前端探针] parseSrt 解析字幕文件失败:", e);
                    // 自动卸载已经不存在或损坏的字幕轨道
                    if (activeVideo.activeSubtitleId) {
                        const qStore = useQueueStore.getState();
                        const queues = qStore.queues.map(q => ({
                            ...q,
                            items: q.items.map(v => {
                                if (v.id === activeVideo.id) {
                                    const remainingSubs = v.subtitles?.filter(s => s.id !== activeVideo.activeSubtitleId) || [];
                                    return {
                                        ...v,
                                        subtitles: remainingSubs,
                                        activeSubtitleId: remainingSubs.length > 0 ? remainingSubs[0].id : null,
                                        subtitleStatus: 'none' as const,
                                        subtitleProgress: 0,
                                        subtitleStatusMsg: undefined
                                    };
                                }
                                return v;
                            })
                        }));
                        useQueueStore.setState({ queues });
                    }
                    subStore.clearCues();
                }
            } else {
                subStore.clearCues();
            }
        };
        loadSubtitles();
    }, [activeVideo?.id, activeVideo?.activeSubtitleId, activeVideo?.subtitleStatus, activeVideo?.path]);

    // Load video source
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (!activeVideo) {
            // 当队列被清空，没有激活的视频时，暂停并剥离视频源
            video.pause();
            video.removeAttribute('src');
            video.load();
            return;
        }

        // Use convertFileSrc for Tauri or direct path for dev
        const src = activeVideo.webPath || activeVideo.path;
        if (video.src !== src) {
            video.src = src;
            video.load();
        }
    }, [activeVideo?.id, videoRef]);

    // Keyboard handling
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const video = videoRef.current;
        if (!video) return;
        // Ignore if an input/textarea is focused
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

        switch (e.key) {
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowRight':
                if (!fastForwardRef.current) {
                    // Single press = skip forward 5s
                    video.currentTime = Math.min(video.duration, video.currentTime + 5);
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - 5);
                break;
        }
    }, [togglePlay, videoRef]);

    // Long press right arrow for fast forward
    const handleKeyDownFF = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'ArrowRight' || e.repeat) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

        const startTime = Date.now();
        const check = () => {
            if (Date.now() - startTime > 300) {
                // Long press detected
                fastForwardRef.current = true;
                setFastForwarding(true);
                const video = videoRef.current;
                if (video) {
                    video.playbackRate = 4;
                }
            }
        };
        fastForwardInterval.current = window.setTimeout(check, 300);
    }, [videoRef, setFastForwarding]);

    const handleKeyUpFF = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'ArrowRight') return;
        if (fastForwardInterval.current) {
            clearTimeout(fastForwardInterval.current);
            fastForwardInterval.current = null;
        }
        if (fastForwardRef.current) {
            fastForwardRef.current = false;
            setFastForwarding(false);
            const video = videoRef.current;
            if (video) {
                video.playbackRate = usePlayerStore.getState().playbackRate;
            }
        }
    }, [videoRef, setFastForwarding]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keydown', handleKeyDownFF);
        window.addEventListener('keyup', handleKeyUpFF);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keydown', handleKeyDownFF);
            window.removeEventListener('keyup', handleKeyUpFF);
        };
    }, [handleKeyDown, handleKeyDownFF, handleKeyUpFF]);

    const handleClick = () => {
        togglePlay();
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center bg-black cursor-pointer overflow-hidden"
            onClick={handleClick}
        >
            <video
                ref={videoRef}
                className="max-w-full max-h-full object-contain"
                playsInline
                preload="metadata"
            />

            {/* Empty state */}
            {!activeVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-secondary)]">
                    <svg className="w-20 h-20 mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-lg font-medium opacity-50">拖拽视频文件至此处开始播放</p>
                    <p className="text-sm mt-1 opacity-30">或在右侧队列中添加视频</p>
                </div>
            )}

            {/* Pause overlay icon */}
            <AnimatePresence>
                {!isPlaying && activeVideo && (
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 1.3, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                        <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                            <Pause className="w-10 h-10 text-white/80" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Fast forward indicator */}
            <AnimatePresence>
                {isFastForwarding && (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-sm font-medium pointer-events-none"
                    >
                        ⏩ 4x 快进中
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
