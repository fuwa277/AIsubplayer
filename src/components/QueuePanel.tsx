import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
    Plus, Trash2, Play, Sparkles,
    FolderPlus, FileText, ChevronDown, X, FolderOpen
} from 'lucide-react';
import { useQueueStore, VideoItem } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { formatTime, generateId } from '../utils';
import { subtitleClient } from '../services/subtitleClient';
import { useLogStore } from '../stores/logStore';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

export const QueuePanel: React.FC = () => {
    const {
        queues, activeQueueId, activeVideoIndex,
        addQueue, setActiveQueue,
        addVideo, removeVideo, setActiveVideoIndex
    } = useQueueStore();

    const [showNewQueueInput, setShowNewQueueInput] = useState(false);
    const [newQueueName, setNewQueueName] = useState('');
    const [queueDropdownOpen, setQueueDropdownOpen] = useState(false);

    interface QueueContextMenuData {
        x: number;
        y: number;
        queueId: string;
    }
    const [queueCtx, setQueueCtx] = useState<QueueContextMenuData | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const handleQueueContextMenu = (e: React.MouseEvent, queueId: string) => {
        e.preventDefault();
        e.stopPropagation();
        // 派发事件关闭其他菜单（包括视频菜单）
        document.dispatchEvent(new CustomEvent('close-video-menus'));
        setQueueCtx({ x: e.clientX, y: e.clientY, queueId });
    };

    useEffect(() => {
        const handleClickOutside = () => setQueueCtx(null);
        if (queueCtx) {
            window.addEventListener('click', handleClickOutside);
            document.addEventListener('close-video-menus', handleClickOutside);
            return () => {
                window.removeEventListener('click', handleClickOutside);
                document.removeEventListener('close-video-menus', handleClickOutside);
            };
        }
    }, [queueCtx]);

    const handleRenameQueue = () => {
        const queue = queues.find(q => q.id === queueCtx?.queueId);
        if (queueCtx && queue) {
            const newName = prompt("请输入新队列名称：", queue.name);
            if (newName && newName.trim()) {
                useQueueStore.getState().renameQueue(queueCtx.queueId, newName.trim());
            }
        }
        setQueueCtx(null);
    };

    const handleDeleteQueue = () => {
        if (queueCtx) {
            useQueueStore.getState().removeQueue(queueCtx.queueId);
        }
        setQueueCtx(null);
    };

    const [batchQueue, setBatchQueue] = useState<string[]>([]);
    const [batchQueueId, setBatchQueueId] = useState<string | null>(null);
    const [isBatchRunning, setIsBatchRunning] = useState(false);
    const batchStopRef = React.useRef(false);

    /** 等待后端就绪（最多 60 秒）。在等待期间把 video 状态改为提示文字。*/
    const waitForBackend = async (): Promise<boolean> => {
        const port = useSettingsStore.getState().backendPort;
        const url = `http://127.0.0.1:${port}/`;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            if (useLogStore.getState().backendCrashed) return false;
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
                if (r.ok) return true;
            } catch { }
            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    };

    // 顺序字幕生成执行器
    const processBatchQueue = async (videoIds: string[], queueId: string) => {
        batchStopRef.current = false;
        setIsBatchRunning(true);
        const store = useQueueStore.getState();
        const settings = useSettingsStore.getState();
        const modelId = settings.selectedModelId;
        const subStore = useSubtitleStore.getState();
        if (!subStore.isVisible) subStore.toggleVisible();

        for (const videoId of videoIds) {
            if (batchStopRef.current) break;

            // 获取最新的 video 对象
            const queue = useQueueStore.getState().queues.find(q => q.id === queueId);
            const video = queue?.items.find(v => v.id === videoId);
            if (!video) continue;

            // 跳过已完成的
            if (video.subtitleStatus === 'done') continue;

            // 查找是否已存在该模型的字幕轨
            const existingTrack = video.subtitles?.find(s => s.type === 'ai' && s.modelId === modelId);
            const trackId = existingTrack ? existingTrack.id : ('ai-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6));

            if (!existingTrack) {
                store.addSubtitleToVideo(videoId, {
                    id: trackId,
                    name: `AI 字幕 (${modelId})`,
                    type: 'ai',
                    modelId,
                });
            }
            store.setActiveSubtitleId(videoId, trackId);

            // 核心：计算断点续传时间
            let resumeOffset = 0;
            if (existingTrack && subStore.cues.length > 0) {
                const lastCue = subStore.cues[subStore.cues.length - 1];
                if (lastCue.id.toString().startsWith(trackId)) {
                    resumeOffset = lastCue.endTime;
                }
            }

            // 确保后端就绪后再发起生成（后端启动慢时给用户提示而不是直接报错）
            const backendOk = await waitForBackend();
            if (!backendOk) {
                store.updateVideoSubtitleStatus?.(videoId, 'error');
                console.error('[QueuePanel] Backend did not start in time for', videoId);
                setBatchQueue(prev => prev.filter(id => id !== videoId));
                continue;
            }

            subtitleClient.generate(videoId, video.path, trackId, resumeOffset);

            // 等待这个视频完成（done/error/paused）再处理下一个
            await new Promise<void>(resolve => {
                const checkDone = () => {
                    const current = useQueueStore.getState().queues
                        .find(q => q.id === queueId)?.items
                        .find(v => v.id === videoId);
                    if (!current || current.subtitleStatus === 'done' || current.subtitleStatus === 'error') {
                        resolve();
                        return;
                    }
                    if (batchStopRef.current) { resolve(); return; }
                    setTimeout(checkDone, 800);
                };
                setTimeout(checkDone, 1000);
            });

            setBatchQueue(prev => prev.filter(id => id !== videoId));
        }

        setIsBatchRunning(false);
        setBatchQueue([]);
        setBatchQueueId(null);
    };

    const handleBatchGenerate = () => {
        const queue = queues.find(q => q.id === queueCtx?.queueId);
        if (!queue) return;
        const pendingIds = queue.items
            .filter(v => v.subtitleStatus !== 'done')
            .map(v => v.id);
        if (pendingIds.length === 0) { setQueueCtx(null); return; }

        setBatchQueue(pendingIds);
        setBatchQueueId(queue.id);
        setQueueCtx(null);
        processBatchQueue(pendingIds, queue.id);
    };

    const handlePauseBatch = () => {
        batchStopRef.current = true;
        setIsBatchRunning(false);
        setQueueCtx(null);
    };

    const handleResumeBatch = () => {
        if (!batchQueueId || batchQueue.length === 0) return;
        processBatchQueue(batchQueue, batchQueueId);
        setQueueCtx(null);
    };

    const handleDragStart = (index: number) => setDraggedIndex(index);
    const handleDragEnter = (index: number) => {
        if (draggedIndex === null || draggedIndex === index) return;
        useQueueStore.getState().reorderVideos(activeQueueId, draggedIndex, index);
        setDraggedIndex(index);
    };
    const handleDrop = () => {
        setDraggedIndex(null);
    };
    const handleDragEnd = () => setDraggedIndex(null);

    const activeQueue = queues.find(q => q.id === activeQueueId) || queues[0];

    // File selection via Tauri native dialog
    const handleAddFiles = useCallback(async () => {
        try {
            const selected = await tauriOpen({
                multiple: true,
                filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'] }]
            });
            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected];
                paths.forEach(p => {
                    const name = p.split(/[/\\]/).pop() || 'Unknown';

                    // 修复闭包陷阱：每次循环时实时获取最新的 Store 状态，而不是用 useCallback 缓存的旧变量
                    const currentStore = useQueueStore.getState();
                    const currentActiveQueue = currentStore.queues.find(q => q.id === activeQueueId);

                    if (currentActiveQueue) {
                        const existingIndex = currentActiveQueue.items.findIndex(v => v.path === p);
                        if (existingIndex !== -1) {
                            currentStore.setActiveVideoIndex(existingIndex);
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
                    addVideo(activeQueueId, video);

                    // 异步获取真实的视频时长以解决进度条一直是 0% 的问题
                    const tempVid = document.createElement('video');
                    tempVid.preload = 'metadata';
                    tempVid.src = webPath;
                    tempVid.onloadedmetadata = () => {
                        const store = useQueueStore.getState();
                        const targetQueue = store.queues.find(q => q.id === activeQueueId);
                        if (targetQueue) {
                            const vIndex = targetQueue.items.findIndex(v => v.id === videoId);
                            if (vIndex !== -1) {
                                const newQueues = store.queues.map(q => q.id === activeQueueId ? {
                                    ...q,
                                    items: q.items.map(v => v.id === videoId ? { ...v, duration: tempVid.duration } : v)
                                } : q);
                                useQueueStore.setState({ queues: newQueues });
                            }
                        }
                    };
                });
            }
        } catch (e) {
            console.error("Failed to open dialog:", e);
        }
    }, [activeQueueId, addVideo]);

    const handleCreateQueue = () => {
        if (newQueueName.trim()) {
            addQueue(newQueueName.trim());
            setNewQueueName('');
            setShowNewQueueInput(false);
        }
    };

    const handlePlayVideo = (index: number) => {
        setActiveVideoIndex(index);
        // 去除自动播放逻辑，仅切换视频
    };

    return (
        <div className="h-full flex flex-col relative w-full overflow-hidden">
            {/* Queue selector */}
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <button
                            onClick={() => setQueueDropdownOpen(!queueDropdownOpen)}
                            onContextMenu={(e) => handleQueueContextMenu(e, activeQueueId)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-tertiary)] text-sm hover:bg-[var(--color-bg-tertiary)]/80 transition-colors"
                        >
                            <span className="truncate">{activeQueue?.name || '默认队列'}</span>
                            <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-secondary)] ml-1 flex-shrink-0" />
                        </button>
                        <AnimatePresence>
                            {queueDropdownOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden"
                                >
                                    {queues.map(q => (
                                        <button
                                            key={q.id}
                                            onClick={() => { setActiveQueue(q.id); setQueueDropdownOpen(false); }}
                                            onContextMenu={(e) => handleQueueContextMenu(e, q.id)}
                                            className={`w-full text-left px-3 py-2 hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center justify-between ${q.id === activeQueueId ? 'text-[var(--color-accent)]' : ''}`}
                                        >
                                            <span className="truncate pr-2 text-sm">{q.name}</span>
                                            <span className="text-[11px] text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">{q.items.length} 项</span>
                                        </button>
                                    ))}
                                    <div className="border-t border-[var(--color-border)]">
                                        <button
                                            onClick={() => { setShowNewQueueInput(true); setQueueDropdownOpen(false); }}
                                            className="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 text-[var(--color-accent)] text-sm"
                                        >
                                            <FolderPlus className="w-4 h-4" />
                                            新建队列
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        onClick={handleAddFiles}
                        className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)] transition-all"
                        title="添加视频"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* New queue input */}
                <AnimatePresence>
                    {showNewQueueInput && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden mt-2"
                        >
                            <div className="flex gap-2">
                                <input
                                    autoFocus
                                    value={newQueueName}
                                    onChange={(e) => setNewQueueName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateQueue()}
                                    placeholder="输入队列名称..."
                                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)]"
                                />
                                <button
                                    onClick={handleCreateQueue}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                                >
                                    创建
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Video list */}
            <div className="flex-1 overflow-y-auto queue-scroll">
                {activeQueue?.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-secondary)] px-4">
                        <FileText className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm text-center opacity-60">队列为空</p>
                        <p className="text-xs text-center opacity-40 mt-1">拖拽视频文件到此处或点击 + 添加</p>
                    </div>
                ) : (
                    <LayoutGroup>
                        <div className="py-1">
                            {activeQueue?.items.map((video, index) => (
                                <QueueItem
                                    key={video.id}
                                    video={video}
                                    isActive={index === activeVideoIndex}
                                    isDragging={draggedIndex === index}
                                    isInBatchQueue={batchQueue.includes(video.id)}
                                    onPlay={() => handlePlayVideo(index)}
                                    onRemove={() => removeVideo(activeQueueId, video.id)}
                                    index={index}
                                    draggable={true}
                                    onDragStart={(e) => {
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData('text/plain', index.toString());
                                        handleDragStart(index);
                                    }}
                                    onDragEnter={(e) => {
                                        e.preventDefault();
                                        handleDragEnter(index);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        handleDrop();
                                    }}
                                    onDragEnd={handleDragEnd}
                                />
                            ))}
                        </div>
                    </LayoutGroup>
                )}
            </div>

            {/* Queue Context Menu */}
            {queueCtx && (
                <div
                    className="fixed z-[999] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl py-1 w-52 overflow-hidden pointer-events-auto"
                    style={{ top: queueCtx.y, left: queueCtx.x }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border)] mb-1 truncate">
                        {queues.find(q => q.id === queueCtx.queueId)?.name}
                    </div>
                    <button onClick={handleRenameQueue} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-text-primary)]">重命名队列</button>
                    {isBatchRunning && batchQueueId === queueCtx.queueId ? (
                        <button onClick={handlePauseBatch} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors text-amber-400 flex items-center gap-2">
                            <span className="text-xs">⏸</span> 暂停批量生成
                        </button>
                    ) : batchQueue.length > 0 && batchQueueId === queueCtx.queueId ? (
                        <button onClick={handleResumeBatch} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-accent)] flex items-center gap-2">
                            <span className="text-xs">▶</span> 继续批量生成 ({batchQueue.length})
                        </button>
                    ) : (
                        <button onClick={handleBatchGenerate} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-accent)]">
                            批量 AI 生成字幕
                        </button>
                    )}
                    <button onClick={handleDeleteQueue} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors text-red-400">删除当前队列</button>
                </div>
            )}
        </div>
    );
};

// Global context menu state interface
interface ContextMenuData {
    x: number;
    y: number;
    videoId: string;
}

// Individual queue item component
const QueueItem: React.FC<{
    video: VideoItem;
    isActive: boolean;
    isDragging: boolean;
    isInBatchQueue: boolean;
    onPlay: () => void;
    onRemove: () => void;
    index: number;
    draggable: boolean;
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
}> = ({ video, isActive, isDragging, isInBatchQueue, onPlay, onRemove, draggable, onDragStart, onDragEnter, onDragOver, onDrop, onDragEnd }) => {
    const [hover, setHover] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);

    // Context menu close listener
    useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        if (contextMenu) {
            window.addEventListener('click', closeMenu);
            document.addEventListener('close-video-menus', closeMenu);
            return () => {
                window.removeEventListener('click', closeMenu);
                document.removeEventListener('close-video-menus', closeMenu);
            };
        }
    }, [contextMenu]);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        // 派发自定义事件，通知其他所有的菜单关闭，解决菜单重叠 bug
        document.dispatchEvent(new CustomEvent('close-video-menus'));
        setContextMenu({ x: e.clientX, y: e.clientY, videoId: video.id });
    };

    const handleOpenFileLocation = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setContextMenu(null);
        try {
            // 【排错诊断代码】
            console.log("====== 准备在文件夹中显示文件 ======");
            console.log("原视频路径:", video.path);
            
            // Tauri v2 推荐使用 revealItemInDir 直接打开目录并高亮选中文件
            await revealItemInDir(video.path);
            console.log("命令已成功发送给系统。");
        } catch (err) {
            console.error("====== 打开文件夹失败 ======", err);
            // 将错误信息直接弹窗显示，避免需要去控制台找
            const errMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
            alert(`打开目录失败！\n\n目标路径：${video.path}\n\n底层错误原因：\n${errMsg}\n\n（请将此错误截图或复制告诉我）`);
        }
    };

    const handleGenerateSubtitle = () => {
        const store = useQueueStore.getState();
        const settings = useSettingsStore.getState();
        const modelId = settings.selectedModelId;
        const subStore = useSubtitleStore.getState();

        // 查找是否已经有该模型生成的字幕轨
        const existingTrack = video.subtitles?.find(s => s.type === 'ai' && s.modelId === modelId);
        const trackId = existingTrack ? existingTrack.id : ('ai-' + Date.now());

        if (!existingTrack) {
            store.addSubtitleToVideo(video.id, {
                id: trackId,
                name: `AI 字幕 (${modelId})`,
                type: 'ai',
                modelId: modelId
            });
        }
        store.setActiveSubtitleId(video.id, trackId);

        // 核心：计算断点续传时间
        let resumeOffset = 0;
        if (existingTrack && subStore.cues.length > 0) {
            const lastCue = subStore.cues[subStore.cues.length - 1];
            // 只取当前这个轨道的最后一句时间
            if (lastCue.id.toString().startsWith(trackId)) {
                resumeOffset = lastCue.endTime;
            }
        }

        // Auto show subtitles if hidden
        if (!subStore.isVisible) {
            subStore.toggleVisible();
        }

        // Trigger socket call
        subtitleClient.generate(video.id, video.path, trackId, resumeOffset);
        setContextMenu(null);
    };

    return (
        <>
            <motion.div
                layout
                layoutId={video.id}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                draggable={draggable}
                animate={{
                    opacity: isDragging ? 0.4 : 1,
                    scale: isDragging ? 0.97 : 1,
                    boxShadow: isDragging ? '0 4px 20px rgba(0,0,0,0.3)' : '0 0px 0px rgba(0,0,0,0)',
                }}
                onDragStartCapture={onDragStart as any}
                onDragEnterCapture={onDragEnter as any}
                onDragOverCapture={onDragOver as any}
                onDropCapture={onDrop as any}
                onDragEndCapture={onDragEnd as any}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                onClick={onPlay}
                onContextMenu={handleContextMenu}
                className={`flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${isDragging
                    ? 'bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/40 ring-1 ring-[var(--color-accent)]/30'
                    : isActive
                        ? 'bg-[var(--color-accent)]/12 border border-[var(--color-accent)]/30 pulse-ring'
                        : 'hover:bg-[var(--color-bg-tertiary)]/60 border border-transparent'
                    }`}
            >
                {/* Thumbnail placeholder */}
                <div className="relative w-16 h-10 rounded-md overflow-hidden bg-[var(--color-bg-tertiary)] flex-shrink-0 border border-black/20">
                    {video.webPath ? (
                        <video 
                            src={`${video.webPath}#t=1`} 
                            className="absolute inset-0 w-full h-full object-cover" 
                            preload="metadata" 
                            muted 
                            playsInline 
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Play className="w-4 h-4 text-[var(--color-text-secondary)] opacity-50" />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-black/10 hover:bg-black/0 transition-colors pointer-events-none" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className={`text-sm truncate ${isActive ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-primary)]'}`}>
                        {video.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                        {/* Playing indicator */}
                        {isActive && (
                            <div className="flex items-center gap-[2px] h-3">
                                <div className="w-[3px] bg-[var(--color-accent)] rounded-full wave-bar" />
                                <div className="w-[3px] bg-[var(--color-accent)] rounded-full wave-bar" />
                                <div className="w-[3px] bg-[var(--color-accent)] rounded-full wave-bar" />
                            </div>
                        )}
                        {/* Subtitle status */}
                        <SubtitleStatusBadge
                            status={video.subtitleStatus}
                            progress={video.subtitleProgress}
                            msg={video.subtitleStatusMsg}
                            isQueued={isInBatchQueue}
                            onCancel={video.subtitleStatus === 'generating' || video.subtitleStatus === 'pending' ? () => {
                                subtitleClient.stop(video.id);
                                useQueueStore.getState().updateVideoSubtitleStatus(video.id, 'none');
                            } : undefined}
                        />
                    </div>
                </div>

                {/* Right Area: Timestamp & Remove button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {video.duration > 0 && (
                        <span className="text-xs text-[var(--color-text-secondary)] font-mono text-right min-w-[75px]">
                            {video.currentTime ? `${formatTime(video.currentTime)} / ` : ''}{formatTime(video.duration)}
                        </span>
                    )}
                    <AnimatePresence>
                        {hover && !isActive && (
                            <motion.button
                                initial={{ opacity: 0, scale: 0.8, width: 0 }}
                                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                                exit={{ opacity: 0, scale: 0.8, width: 0 }}
                                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                                className="p-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-red-400 transition-colors overflow-hidden"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* Right Click menu popup */}
            {contextMenu && (
                <div
                    className="fixed z-[999] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl py-1 w-48 overflow-hidden pointer-events-auto"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border)] mb-1 truncate">
                        {video.name}
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onPlay(); setContextMenu(null); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 text-[var(--color-text-primary)]"
                    >
                        <Play className="w-4 h-4" />
                        播放视频
                    </button>
                    <button
                        onClick={handleGenerateSubtitle}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 text-[var(--color-text-primary)]"
                    >
                        <Sparkles className="w-4 h-4" />
                        AI 生成字幕
                    </button>
                    <button
                        onClick={handleOpenFileLocation}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 text-[var(--color-text-primary)]"
                    >
                        <FolderOpen className="w-4 h-4" />
                        打开所在目录
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); setContextMenu(null); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 text-red-400"
                    >
                        <Trash2 className="w-4 h-4" />
                        移除该视频
                    </button>
                </div>
            )}
        </>
    );
};

const SubtitleStatusBadge: React.FC<{ status: string; progress: number; msg?: string; isQueued?: boolean; onCancel?: () => void }> = ({ status, progress, msg, isQueued, onCancel }) => {
    if (isQueued && status !== 'generating' && status !== 'done') {
        return <span className="text-[10px] text-amber-400 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />等待生成</span>;
    }
    switch (status) {
        case 'generating':
            return (
                <div className="flex flex-col gap-1 items-start w-full pr-2">
                    <div className="flex items-center gap-1.5 w-full">
                        <div className="w-16 h-1 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden flex-shrink-0">
                            <div
                                className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <span className="text-[10px] text-[var(--color-accent)]">{progress}%</span>
                        {onCancel && (
                            <button onClick={(e) => { e.stopPropagation(); onCancel(); }} className="ml-0.5 p-0.5 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-red-400 transition-colors" title="停止生成">
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                    {msg && <span className="text-[10px] text-[var(--color-text-secondary)] truncate max-w-[150px]" title={msg}>{msg}</span>}
                </div>
            );
        case 'done':
            return <span className="text-[10px] text-emerald-400">字幕已就绪</span>;
        case 'paused':
            return <span className="text-[10px] text-amber-400">已暂停</span>;
        case 'error':
            return <span className="text-[10px] text-red-400">出错</span>;
        default:
            return <span className="text-[10px] text-[var(--color-text-secondary)] opacity-50">无字幕</span>;
    }
};
