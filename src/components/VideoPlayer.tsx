import React, { useRef, useEffect, useCallback } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useQueueStore } from '../stores/queueStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { parseSrt } from '../services/srtParser';
import { motion, AnimatePresence } from 'framer-motion';
import { Pause } from 'lucide-react';

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

            if (!activeVideo || !activeVideo.activeSubtitleId) {
                subStore.clearCues();
                return;
            }

            // 如果正在生成中，不要从本地频繁加载覆盖内存，以免打断推流和引发数据冲突
            if (activeVideo.subtitleStatus === 'generating') {
                return;
            }

            const activeTrack = activeVideo.subtitles?.find(s => s.id === activeVideo.activeSubtitleId);
            if (activeTrack && activeTrack.path) {
                try {
                    const cues = await parseSrt(activeTrack.path, activeTrack.id);
                    subStore.setCues(cues);
                } catch (e) {
                    console.error("Failed to load subtitle from disk:", e);
                }
            } else {
                subStore.clearCues();
            }
        };
        loadSubtitles();
    }, [activeVideo?.id, activeVideo?.activeSubtitleId, activeVideo?.subtitleStatus]);

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
