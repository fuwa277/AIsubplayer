import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Clock, Search, Edit3, Check, X, Download, RefreshCw } from 'lucide-react';
import { useSubtitleStore, SubtitleCue } from '../stores/subtitleStore';
import { usePlayerStore } from '../stores/playerStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatTime } from '../utils';
import { save } from '@tauri-apps/plugin-dialog';
import { writeSrt } from '../services/srtParser';

interface SubtitleTimelineProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const SubtitleTimeline: React.FC<SubtitleTimelineProps> = ({ videoRef }) => {
    const { cues, splitAndUpdateCue, isGenerating, generationProgress } = useSubtitleStore();
    const { currentTime } = usePlayerStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [editingId, setEditingId] = useState<string | number | null>(null);
    const [reidentifyingId, setReidentifyingId] = useState<string | number | null>(null);
    const [editText, setEditText] = useState('');
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Auto-scroll to active subtitle using Virtual List
    useEffect(() => {
        if (isGenerating || filteredCues.length === 0) return;
        const activeIndex = filteredCues.findIndex(c => currentTime >= c.startTime && currentTime <= c.endTime);
        if (activeIndex !== -1 && virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
                index: activeIndex,
                align: 'center',
                behavior: 'smooth'
            });
        }
    }, [currentTime, isGenerating]);

    const handleJumpTo = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
    };

    const handleReidentify = async (cue: SubtitleCue) => {
        const settings = useSettingsStore.getState();
        const activeVideo = useQueueStore.getState().getActiveVideo();
        if (!activeVideo) return;

        setReidentifyingId(cue.id);
        try {
            const res = await fetch(`http://127.0.0.1:${settings.backendPort}/api/reidentify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    video_path: activeVideo.path,
                    start_time: cue.startTime,
                    end_time: cue.endTime,
                    model_id: settings.selectedModelId,
                    inference_device: settings.inferenceDevice,
                    compute_type: settings.computeType,
                    source_language: settings.sourceLanguage,
                    target_language: settings.targetLanguage
                })
            });
            const data = await res.json();
            if (data.text) {
                // Update the cue in the store
                useSubtitleStore.getState().updateCue(cue.id, data.text, data.original_text || cue.originalText);

                // 强制保存物理文件（因为此时未处于手写编辑态，直接调 handleSaveEdit 会因 editingId 为 null 而被拦截拦截，导致无法落盘）
                setTimeout(async () => {
                    const updatedCues = useSubtitleStore.getState().cues;
                    if (activeVideo && activeVideo.activeSubtitleId) {
                        const activeTrack = activeVideo.subtitles?.find(s => s.id === activeVideo.activeSubtitleId);
                        if (activeTrack && activeTrack.path) {
                            try {
                                await writeSrt(activeTrack.path, updatedCues);
                                console.log("[前端探针] 单句重新识别结果已安全落盘:", activeTrack.path);
                            } catch (e) { console.error("Auto-save failed after reidentify:", e); }
                        }
                    }
                }, 100);
            }
        } catch (e) {
            console.error("Re-identify failed:", e);
        } finally {
            setReidentifyingId(null);
        }
    };

    const handleStartEdit = (cue: SubtitleCue) => {
        setEditingId(cue.id);
        setEditText(cue.text);
    };

    const handleSaveEdit = () => {
        if (editingId) {
            splitAndUpdateCue(editingId, editText);
            setEditingId(null);
            setEditText('');

            // 延迟以确保 Zustand 的 state 已经更新完成，然后覆写物理文件
            setTimeout(async () => {
                const updatedCues = useSubtitleStore.getState().cues;
                const activeVideo = useQueueStore.getState().getActiveVideo();
                if (activeVideo && activeVideo.activeSubtitleId) {
                    const activeTrack = activeVideo.subtitles?.find(s => s.id === activeVideo.activeSubtitleId);
                    if (activeTrack && activeTrack.path) {
                        try {
                            await writeSrt(activeTrack.path, updatedCues);
                        } catch (e) { console.error("Auto-save failed:", e); }
                    }
                }
            }, 100);
        }
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditText('');
    };

    const filteredCues = searchQuery
        ? cues.filter(c =>
            c.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.originalText && c.originalText.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        : cues;

    const handleExportSrt = async () => {
        if (cues.length === 0) return;
        try {
            const filePath = await save({
                filters: [{ name: 'SRT Subtitle', extensions: ['srt'] }],
                defaultPath: `subtitle_export_${Date.now()}.srt`
            });
            if (filePath) {
                await writeSrt(filePath, cues);
            }
        } catch (e) {
            console.error("Failed to export SRT:", e);
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header with search */}
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索字幕内容..."
                            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)]/50"
                        />
                    </div>
                    <button
                        onClick={handleExportSrt}
                        title="导出为 SRT 文件"
                        className="p-1.5 rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-secondary)] transition-colors flex-shrink-0"
                    >
                        <Download className="w-4 h-4" />
                    </button>
                </div>
                {/* Generation progress */}
                {isGenerating && (
                    <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-[var(--color-accent)] rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${generationProgress}%` }}
                                transition={{ duration: 0.3 }}
                            />
                        </div>
                        <span className="text-[10px] text-[var(--color-accent)] whitespace-nowrap">
                            生成中 {generationProgress}%
                        </span>
                    </div>
                )}
            </div>

            {/* Cue list */}
            <div className="flex-1 overflow-hidden" style={{ height: '100%', minHeight: 0 }}>
                {filteredCues.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-secondary)] px-4">
                        <Clock className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm text-center opacity-60">
                            {cues.length === 0 ? '暂无字幕' : '未找到匹配项'}
                        </p>
                        <p className="text-xs text-center opacity-40 mt-1">
                            {cues.length === 0 ? '请手动生成或导入字幕文件' : '尝试其他搜索关键词'}
                        </p>
                    </div>
                ) : (
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: '100%' }}
                        data={filteredCues}
                        itemContent={(_, cue) => {
                            const isActive = currentTime >= cue.startTime && currentTime <= cue.endTime;
                            const isEditing = editingId === cue.id;

                            return (
                                <div
                                    onClick={() => !isEditing && handleJumpTo(cue.startTime)}
                                    onDoubleClick={() => handleStartEdit(cue)}
                                    className={`group px-3 py-1.5 mx-1 my-0.5 rounded-lg cursor-pointer transition-all text-sm ${isActive
                                        ? 'bg-[var(--color-accent)]/12 border-l-2 border-[var(--color-accent)]'
                                        : 'hover:bg-[var(--color-bg-tertiary)]/60 border-l-2 border-transparent'
                                        }`}
                                >
                                    {/* Time label */}
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className={`text-[10px] font-mono ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
                                            }`}>
                                            {formatTime(cue.startTime)} → {formatTime(cue.endTime)}
                                        </span>
                                        {!isEditing && (
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleStartEdit(cue); }}
                                                    title="编辑"
                                                    className="p-0.5 rounded hover:text-[var(--color-accent)] text-[var(--color-text-secondary)]"
                                                >
                                                    <Edit3 className="w-2.5 h-2.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleReidentify(cue); }}
                                                    title="重新 AI 识别该段"
                                                    disabled={reidentifyingId === cue.id}
                                                    className={`p-0.5 rounded hover:text-[var(--color-accent)] text-[var(--color-text-secondary)] ${reidentifyingId === cue.id ? 'animate-spin' : ''}`}
                                                >
                                                    <RefreshCw className="w-2.5 h-2.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Text content */}
                                    {isEditing ? (
                                        <div className="flex items-start gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
                                            <textarea
                                                autoFocus
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && e.ctrlKey) {
                                                        e.preventDefault();
                                                        handleSaveEdit();
                                                    }
                                                    if (e.key === 'Escape') handleCancelEdit();
                                                }}
                                                placeholder="在此编辑（使用 Enter 换行可自动将该段字幕一分为二，Ctrl+Enter 或点击右侧保存）"
                                                className="flex-1 px-2 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-accent)]/50 outline-none text-[var(--color-text-primary)] resize-none min-h-[40px]"
                                            />
                                            <div className="flex flex-col gap-1">
                                                <button
                                                    onClick={handleSaveEdit}
                                                    className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                                                >
                                                    <Check className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={handleCancelEdit}
                                                    className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className={`text-xs leading-relaxed ${isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
                                                }`}>
                                                {cue.text}
                                            </p>
                                            {cue.originalText && (
                                                <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5 opacity-60">
                                                    {cue.originalText}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        }}
                    />
                )}
            </div>

            {/* Footer stats */}
            <div className="px-3 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)] flex justify-between">
                <span>共 {cues.length} 条字幕</span>
                {searchQuery && <span>匹配 {filteredCues.length} 条</span>}
            </div>
        </div>
    );
};
