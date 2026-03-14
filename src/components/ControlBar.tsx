import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Play, Pause, SkipBack, SkipForward,
    Volume2, VolumeX, Volume1,
    Subtitles, PanelRightClose, PanelRightOpen,
    Sun, Moon, Settings, Check, Upload, Sparkles, Languages, Maximize, Minimize, Gauge
} from 'lucide-react';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useQueueStore } from '../stores/queueStore';
import { subtitleClient } from '../services/subtitleClient';
import { parseSrt } from '../services/srtParser';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { formatTime } from '../utils';

interface ControlBarProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    onOpenSettings: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({ videoRef, onOpenSettings }) => {
    const {
        isPlaying, togglePlay, currentTime, duration, volume, isMuted, toggleMute, setVolume,
        playbackRate, setPlaybackRate, setControlsVisible
    } = usePlayerStore();
    const { theme, toggleTheme, sidebarOpen, toggleSidebar } = useSettingsStore();
    const { isVisible: subtitleVisible, toggleVisible: toggleSubtitle } = useSubtitleStore();
    const { playNext, playPrev, getActiveVideo, setActiveSubtitleId, addSubtitleToVideo } = useQueueStore();
    const activeVideo = getActiveVideo();

    const [isVisible, setIsVisible] = useState(true);
    const [volumeHover, setVolumeHover] = useState(false);
    const [subtitleHover, setSubtitleHover] = useState(false);
    const [speedHover, setSpeedHover] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState<number>(0);
    const hideTimer = useRef<number | null>(null);
    const volumeHideTimer = useRef<number | null>(null);
    const subtitleHideTimer = useRef<number | null>(null);
    const speedHideTimer = useRef<number | null>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const isHoveringBar = useRef(false);

    // Auto-hide logic
    const showBar = useCallback(() => {
        setIsVisible(true);
        setControlsVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => {
            if (!isDragging && !isHoveringBar.current) {
                setIsVisible(false);
                setControlsVisible(false);
            }
        }, 1500);
    }, [isDragging, setControlsVisible]);

    const keepVisible = () => {
        isHoveringBar.current = true;
        setIsVisible(true);
        setControlsVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
    };

    const handleLeaveBar = () => {
        isHoveringBar.current = false;
        showBar();
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            // Determine if mouse is over the right sidebar area
            const isOverSidebar = useSettingsStore.getState().sidebarOpen && e.clientX > window.innerWidth - 330; // 320px + 10px buffer

            // Only show the bar if:
            // 1. Not over the sidebar
            // 2. OR the mouse is explicitly in the bottom part of the screen where the controls are (bottom 20%)
            const isAtBottom = e.clientY > window.innerHeight * 0.8;

            if (isOverSidebar && !isAtBottom) {
                return;
            }

            showBar();
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [showBar]);

    // Keep visible when paused, auto-hide all when playing starts
    useEffect(() => {
        if (!isPlaying) {
            setIsVisible(true);
            setControlsVisible(true);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        } else {
            // 当进入播放状态时，立刻强制使控制栏收起，给予沉浸感
            setIsVisible(false);
            setControlsVisible(false);
        }
    }, [isPlaying, setControlsVisible]);

    // Volume hover with delay
    const handleVolumeEnter = () => {
        if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current);
        volumeHideTimer.current = window.setTimeout(() => setVolumeHover(true), 300);
    };
    const handleVolumeLeave = () => {
        if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current);
        volumeHideTimer.current = window.setTimeout(() => setVolumeHover(false), 200);
    };

    // Subtitle hover with delay
    const handleSubtitleEnter = () => {
        if (subtitleHideTimer.current) clearTimeout(subtitleHideTimer.current);
        subtitleHideTimer.current = window.setTimeout(() => setSubtitleHover(true), 300);
    };
    const handleSubtitleLeave = () => {
        if (subtitleHideTimer.current) clearTimeout(subtitleHideTimer.current);
        subtitleHideTimer.current = window.setTimeout(() => setSubtitleHover(false), 200);
    };

    // Speed hover with delay
    const handleSpeedEnter = () => {
        if (speedHideTimer.current) clearTimeout(speedHideTimer.current);
        speedHideTimer.current = window.setTimeout(() => setSpeedHover(true), 300);
    };
    const handleSpeedLeave = () => {
        if (speedHideTimer.current) clearTimeout(speedHideTimer.current);
        speedHideTimer.current = window.setTimeout(() => setSpeedHover(false), 200);
    };

    // Progress bar interaction
    const seekTo = (clientX: number) => {
        if (!progressBarRef.current || !videoRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        videoRef.current.currentTime = ratio * duration;
    };

    const handleProgressMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDragging(true);
        seekTo(e.clientX);
        const onMove = (me: MouseEvent) => seekTo(me.clientX);
        const onUp = () => {
            setIsDragging(false);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleProgressMouseMove = (e: React.MouseEvent) => {
        if (!progressBarRef.current || duration <= 0) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHoverTime(ratio * duration);
        setHoverX(e.clientX - rect.left);
    };

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen().catch(e => console.error("Fullscreen failed:", e));
        } else {
            await document.exitFullscreen().catch(e => console.error("Exit fullscreen failed:", e));
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute bottom-0 left-0 right-0 z-30"
                    onMouseEnter={keepVisible}
                    onMouseLeave={handleLeaveBar}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Gradient background */}
                    <div className="absolute inset-0 bg-[var(--color-bg-primary)]/80 backdrop-blur-md border-t border-[var(--color-border)] pointer-events-none" />

                    <div className={`relative px-6 pb-6 pt-10 ${theme === 'light' ? 'text-[#1a1a2e]' : 'text-white'}`}>
                        {/* Progress bar */}
                        <div
                            ref={progressBarRef}
                            className={`w-full h-1.5 rounded-full cursor-pointer mb-4 group hover:h-2.5 transition-all duration-200 relative ${theme === 'light' ? 'bg-black/15' : 'bg-white/15'}`}
                            onMouseDown={handleProgressMouseDown}
                            onMouseMove={handleProgressMouseMove}
                            onMouseEnter={handleProgressMouseMove}
                            onMouseLeave={() => setHoverTime(null)}
                        >
                            <div
                                className="h-full bg-[var(--color-accent)] rounded-full relative transition-none"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <AnimatePresence>
                                {hoverTime !== null && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, x: '-50%' }}
                                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                                        exit={{ opacity: 0, y: 10, x: '-50%' }}
                                        transition={{ duration: 0.15 }}
                                        className="absolute -top-28 px-1.5 py-1.5 text-xs font-mono text-white bg-black/90 rounded-lg shadow-2xl pointer-events-none flex flex-col items-center gap-1 border border-white/10 z-[100]"
                                        style={{ left: `${hoverX}px` }}
                                    >
                                        <div className="w-36 h-[72px] bg-[var(--color-bg-tertiary)] rounded overflow-hidden flex-shrink-0 relative shadow-inner">
                                            {activeVideo && (
                                                <video
                                                    ref={(el) => {
                                                        if (el && hoverTime !== null && Math.abs(el.currentTime - hoverTime) > 0.1) {
                                                            el.currentTime = hoverTime;
                                                        }
                                                    }}
                                                    src={activeVideo.webPath}
                                                    className="w-full h-full object-cover"
                                                    preload="auto"
                                                    muted
                                                />
                                            )}
                                        </div>
                                        <div className="font-semibold px-2 pb-0.5">{formatTime(hoverTime)}</div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Controls row (Absolute positioning for center to prevent layout shift) */}
                        <div className="relative flex items-center justify-between mt-1">
                            {/* Left: theme toggle & Time */}
                            <div className="flex-1 flex items-center gap-2">
                                <button
                                    onClick={toggleTheme}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title={theme === 'dark' ? '切换浅色' : '切换深色'}
                                >
                                    {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
                                </button>
                                <span className={`text-xs font-mono min-w-[80px] ${theme === 'light' ? 'text-slate-600' : 'text-white/60'}`}>
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </span>
                            </div>

                            {/* Center: playback controls */}
                            <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); playPrev(); }}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title="上一个"
                                >
                                    <SkipBack className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                                    className={`p-3 rounded-full transition-all outline-none ${theme === 'light' ? 'text-slate-900 bg-black/10 hover:bg-black/15' : 'text-white bg-white/15 hover:bg-white/25'}`}
                                    title={isPlaying ? '暂停' : '播放'}
                                >
                                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 ml-0.5 fill-current" />}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); playNext(); }}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title="下一个"
                                >
                                    <SkipForward className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Right controls */}
                            <div className="flex-1 flex items-center justify-end gap-1">
                                {/* Volume */}
                                <div
                                    className="flex items-center"
                                    onMouseEnter={handleVolumeEnter}
                                    onMouseLeave={handleVolumeLeave}
                                >
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                                        className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                        title={isMuted ? '取消静音' : '静音'}
                                    >
                                        <VolumeIcon className="w-4.5 h-4.5" />
                                    </button>
                                    <AnimatePresence>
                                        {volumeHover && (
                                            <motion.div
                                                initial={{ width: 0, opacity: 0 }}
                                                animate={{ width: 100, opacity: 1 }}
                                                exit={{ width: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden flex items-center h-full gap-2 pl-2"
                                            >
                                                <div
                                                    className="w-16 h-1.5 bg-[var(--color-text-secondary)]/30 rounded-full cursor-pointer relative flex-shrink-0"
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        const updateVolume = (clientX: number) => {
                                                            const newVol = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                                                            setVolume(newVol);
                                                        };
                                                        updateVolume(e.clientX);
                                                        const onMove = (me: MouseEvent) => updateVolume(me.clientX);
                                                        const onUp = () => {
                                                            window.removeEventListener('mousemove', onMove);
                                                            window.removeEventListener('mouseup', onUp);
                                                        };
                                                        window.addEventListener('mousemove', onMove);
                                                        window.addEventListener('mouseup', onUp);
                                                    }}
                                                >
                                                    <div className="absolute left-0 top-0 bottom-0 bg-[var(--color-accent)] rounded-full indicator-bar" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
                                                </div>
                                                <span className="text-[10px] text-[var(--color-text-secondary)] font-mono w-6 shrink-0 text-center">
                                                    {Math.round((isMuted ? 0 : volume) * 100)}
                                                </span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Speed */}
                                <div
                                    className="relative flex items-center"
                                    onMouseEnter={handleSpeedEnter}
                                    onMouseLeave={handleSpeedLeave}
                                >
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // 点击按钮本身能在 1x 和之前选择的高速中切换，如果已经是正常的就切换到 2x
                                            setPlaybackRate(playbackRate === 1 ? 2 : 1);
                                        }}
                                        className={`p-2 rounded-lg transition-all ${playbackRate !== 1
                                            ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/15'
                                            : (theme === 'light' ? 'text-slate-500 hover:text-slate-900 hover:bg-black/10' : 'text-white/50 hover:text-white hover:bg-white/10')
                                            }`}
                                        title={`当前倍速: ${playbackRate}x`}
                                    >
                                        <Gauge className="w-4.5 h-4.5" />
                                    </button>

                                    <AnimatePresence>
                                        {speedHover && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                                transition={{ duration: 0.15 }}
                                                className={`absolute bottom-full right-1/2 translate-x-1/2 mb-4 w-20 border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden py-2 z-50 pointer-events-auto flex flex-col-reverse ${theme === 'light' ? 'bg-[var(--color-bg-primary)]/90 backdrop-blur-xl shadow-black/5' : 'bg-[#1a1a24] shadow-black/50'}`}
                                            >
                                                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0].map(rate => (
                                                    <button
                                                        key={rate}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setPlaybackRate(rate);
                                                            setSpeedHover(false);
                                                        }}
                                                        className={`w-full px-4 py-1.5 text-center text-sm font-mono transition-colors ${playbackRate === rate ? 'text-[var(--color-accent)] font-medium' : (theme === 'light' ? 'text-slate-700 hover:bg-black/5' : 'text-white/90 hover:bg-white/5')}`}
                                                    >
                                                        {rate === 1.0 ? '正常' : `${rate}x`}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Subtitle toggle & menu */}
                                <div
                                    className="relative flex items-center"
                                    onMouseEnter={handleSubtitleEnter}
                                    onMouseLeave={handleSubtitleLeave}
                                >
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleSubtitle();
                                        }}
                                        className={`p-2 rounded-lg transition-all ${subtitleVisible
                                            ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/15'
                                            : (theme === 'light' ? 'text-slate-500 hover:text-slate-900 hover:bg-black/10' : 'text-white/50 hover:text-white hover:bg-white/10')
                                            }`}
                                        title={subtitleVisible ? '关闭全局字幕' : '开启全局字幕'}
                                    >
                                        <Subtitles className="w-4.5 h-4.5" />
                                    </button>

                                    <AnimatePresence>
                                        {subtitleHover && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                                transition={{ duration: 0.15 }}
                                                className={`absolute bottom-full right-0 mb-4 w-60 border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden py-2 z-50 pointer-events-auto ${theme === 'light' ? 'bg-[var(--color-bg-primary)]/90 backdrop-blur-xl shadow-black/5' : 'bg-[#1a1a24] shadow-black/50'}`}
                                            >
                                                {!activeVideo ? (
                                                    <div className="px-4 py-4 text-center text-sm text-[var(--color-text-secondary)]">
                                                        请先在播放列表中<br />添加并打开一个视频
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                                                            当前字幕
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setActiveSubtitleId(activeVideo.id, null); }}
                                                            className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between transition-colors ${theme === 'light' ? 'hover:bg-black/5 text-slate-700' : 'hover:bg-white/5 text-white/90'}`}
                                                        >
                                                            <span className={!activeVideo.activeSubtitleId ? 'text-[var(--color-accent)] font-medium' : ''}>
                                                                关闭字幕处理
                                                            </span>
                                                            {!activeVideo.activeSubtitleId && <Check className="w-4 h-4 text-[var(--color-accent)]" />}
                                                        </button>

                                                        {activeVideo.subtitles && activeVideo.subtitles.length > 0 && (
                                                            <>
                                                                <div className="h-px bg-[var(--color-border)] my-1.5 mx-2 opacity-30" />
                                                                <div className="px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                                                                    已装载字幕
                                                                </div>
                                                                <div className="max-h-40 overflow-y-auto">
                                                                    {activeVideo.subtitles.map(sub => (
                                                                        <button
                                                                            key={sub.id}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setActiveSubtitleId(activeVideo.id, sub.id);
                                                                                if (!subtitleVisible) toggleSubtitle();
                                                                            }}
                                                                            className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between group transition-colors gap-2 ${theme === 'light' ? 'hover:bg-black/5 text-slate-700' : 'hover:bg-white/5 text-white/90'}`}
                                                                        >
                                                                            <div className="flex flex-col truncate pr-2 overflow-hidden flex-1">
                                                                                <span className={`truncate ${activeVideo.activeSubtitleId === sub.id ? 'text-[var(--color-accent)] font-medium' : ''}`}>
                                                                                    {sub.name}
                                                                                </span>
                                                                                {sub.type === 'ai' && <span className={`text-[10px] truncate ${activeVideo.activeSubtitleId === sub.id ? 'text-[var(--color-accent)]/70' : 'text-[var(--color-text-secondary)]'}`}>AI 生成 ({sub.modelId})</span>}
                                                                            </div>
                                                                            {activeVideo.activeSubtitleId === sub.id && <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        )}

                                                        <div className="h-px bg-[var(--color-border)] my-1.5 mx-2 opacity-30" />
                                                        <div className="px-2 space-y-1">
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    try {
                                                                        const selected = await tauriOpen({
                                                                            multiple: false,
                                                                            filters: [{ name: '字幕文件', extensions: ['srt'] }]
                                                                        });
                                                                        if (selected && typeof selected === 'string') {
                                                                            const pathParts = selected.split(/[/\\]/);
                                                                            const filename = pathParts[pathParts.length - 1];
                                                                            const fakeId = 'ext-' + Date.now();

                                                                            addSubtitleToVideo(activeVideo.id, {
                                                                                id: fakeId,
                                                                                name: filename,
                                                                                type: 'external',
                                                                                path: selected
                                                                            });

                                                                            // 解析并填充到 store
                                                                            const cues = await parseSrt(selected);
                                                                            const subStore = useSubtitleStore.getState();
                                                                            subStore.setCues(cues);

                                                                            setActiveSubtitleId(activeVideo.id, fakeId);
                                                                            if (!subtitleVisible) toggleSubtitle();
                                                                        }
                                                                    } catch (err) {
                                                                        console.error("Failed loading external srt:", err);
                                                                    }
                                                                }}
                                                                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors ${theme === 'light' ? 'hover:bg-black/5 text-slate-700' : 'hover:bg-white/5 text-white/90'}`}
                                                            >
                                                                <Upload className="w-4 h-4 opacity-70" /> 导入外部字幕文件
                                                            </button>
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    try {
                                                                        const selected = await tauriOpen({
                                                                            multiple: false,
                                                                            filters: [{ name: '字幕文件', extensions: ['srt'] }]
                                                                        });
                                                                        if (selected && typeof selected === 'string') {
                                                                            const pathParts = selected.split(/[/\\]/);
                                                                            const filename = pathParts[pathParts.length - 1];
                                                                            const fakeId = 'ext-trans-' + Date.now();
                                                                            const targetLang = useSettingsStore.getState().targetLanguage;
                                                                            const backendPort = useSettingsStore.getState().backendPort;

                                                                            addSubtitleToVideo(activeVideo.id, {
                                                                                id: fakeId,
                                                                                name: filename + ` (翻译至 ${targetLang})`,
                                                                                type: 'external',
                                                                                path: selected
                                                                            });

                                                                            const cues = await parseSrt(selected);
                                                                            const subStore = useSubtitleStore.getState();
                                                                            subStore.setCues(cues);

                                                                            setActiveSubtitleId(activeVideo.id, fakeId);
                                                                            if (!subtitleVisible) toggleSubtitle();

                                                                            // 模拟进度
                                                                            const qStore = useQueueStore.getState();
                                                                            qStore.updateVideoSubtitleStatus(activeVideo.id, 'generating', 0);

                                                                            // 逐句翻译
                                                                            // 为避免同时发几百个请求导致拥堵甚至被墙/超限，采用串行翻译
                                                                            for (let i = 0; i < cues.length; i++) {
                                                                                const cue = cues[i];
                                                                                try {
                                                                                    const res = await fetch(`http://127.0.0.1:${backendPort}/api/translate`, {
                                                                                        method: 'POST',
                                                                                        headers: { 'Content-Type': 'application/json' },
                                                                                        body: JSON.stringify({
                                                                                            text: cue.text,
                                                                                            source_language: 'auto',
                                                                                            target_language: targetLang
                                                                                        })
                                                                                    });
                                                                                    const data = await res.json();
                                                                                    // 将新获取的翻译放入主 text，将原来的字幕挪到 originalText 用于双语展现
                                                                                    subStore.updateCue(cue.id, data.text, cue.text);

                                                                                    const prog = Math.min(((i + 1) / cues.length) * 100, 99.9);
                                                                                    qStore.updateVideoSubtitleStatus(activeVideo.id, 'generating', parseFloat(prog.toFixed(1)));
                                                                                } catch (te) {
                                                                                    console.error(`Translation failed at index ${i}:`, te);
                                                                                }
                                                                            }

                                                                            qStore.updateVideoSubtitleStatus(activeVideo.id, 'done', 100);
                                                                        }
                                                                    } catch (err) {
                                                                        console.error("Failed translating external srt:", err);
                                                                    }
                                                                }}
                                                                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors ${theme === 'light' ? 'hover:bg-black/5 text-slate-700' : 'hover:bg-white/5 text-white/90'}`}
                                                            >
                                                                <Languages className="w-4 h-4 opacity-70" /> AI智能翻译本地字幕
                                                            </button>
                                                            <button
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    const modelId = useSettingsStore.getState().selectedModelId;
                                                                    const targetLang = useSettingsStore.getState().targetLanguage || 'auto';
                                                                    
                                                                    const existingTrack = activeVideo.subtitles?.find(s => s.type === 'ai' && s.modelId === modelId);
                                                                    const trackId = existingTrack ? existingTrack.id : ('ai-' + Date.now());

                                                                    const getAiSrtPath = (videoPath: string, mId: string, tLang: string) => {
                                                                        const sep = videoPath.includes('\\') ? '\\' : '/';
                                                                        const lastSlash = videoPath.lastIndexOf(sep);
                                                                        const dir = videoPath.substring(0, lastSlash);
                                                                        const nameExt = videoPath.substring(lastSlash + 1);
                                                                        const lastDot = nameExt.lastIndexOf('.');
                                                                        const name = lastDot !== -1 ? nameExt.substring(0, lastDot) : nameExt;
                                                                        const safeModelId = mId.replace(/[\/\\:*?"<>|]/g, '-');
                                                                        return `${dir}${sep}${name}.${tLang}-AI-${safeModelId}.srt`;
                                                                    };
                                                                    const expectedSrtPath = existingTrack?.path || getAiSrtPath(activeVideo.path, modelId, targetLang);

                                                                    let resumeOffset = 0;
                                                                    const subStore = useSubtitleStore.getState();
                                                                    if (existingTrack) {
                                                                        try {
                                                                            const fileCues = await parseSrt(expectedSrtPath, trackId);
                                                                            if (fileCues && fileCues.length > 0) {
                                                                                resumeOffset = fileCues[fileCues.length - 1].endTime;
                                                                                subStore.setCues(fileCues);
                                                                            }
                                                                        } catch(err) {
                                                                            subStore.clearCues();
                                                                        }
                                                                    }

                                                                    if (!existingTrack || !existingTrack.path) {
                                                                        addSubtitleToVideo(activeVideo.id, {
                                                                            id: trackId,
                                                                            name: `AI 字幕 (${modelId})`,
                                                                            type: 'ai',
                                                                            modelId: modelId,
                                                                            path: expectedSrtPath
                                                                        });
                                                                    }

                                                                    setActiveSubtitleId(activeVideo.id, trackId);
                                                                    if (!subtitleVisible) toggleSubtitle();

                                                                    // 开始真实的 WebSocket 流式转录
                                                                    subtitleClient.generate(activeVideo.id, activeVideo.path, trackId, resumeOffset);
                                                                }}
                                                                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors ${theme === 'light' ? 'hover:bg-black/5 text-slate-700' : 'hover:bg-white/5 text-white/90'}`}
                                                            >
                                                                <Sparkles className="w-4 h-4 opacity-70" /> 使用 AI 自动生成
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Settings */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title="设置"
                                >
                                    <Settings className="w-4.5 h-4.5" />
                                </button>

                                {/* Sidebar toggle */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title={sidebarOpen ? '关闭侧边栏' : '打开侧边栏'}
                                >
                                    {sidebarOpen
                                        ? <PanelRightClose className="w-4.5 h-4.5" />
                                        : <PanelRightOpen className="w-4.5 h-4.5" />}
                                </button>

                                {/* Fullscreen */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                                    className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                                    title={isFullscreen ? '退出全屏' : '全屏'}
                                >
                                    {isFullscreen ? <Minimize className="w-4.5 h-4.5" /> : <Maximize className="w-4.5 h-4.5" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
