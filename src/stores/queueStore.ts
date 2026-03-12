import { create } from 'zustand';

export interface SubtitleTrack {
    id: string;        // 唯一ID
    name: string;      // 例如 "中文防遮挡", "AI (Large V3)"
    type: 'ai' | 'external';
    path?: string;     // 本地路径
    modelId?: string;  // 生成该字幕的模型
}

export interface VideoItem {
    id: string;
    name: string;
    path: string; // 后端需要用的绝对物理路径
    webPath?: string; // 供 React <video> 加载的 asset:// 或者是 blob:// 路径
    duration: number;
    currentTime?: number; // 记录播放进度
    thumbnail?: string;
    subtitleStatus: 'none' | 'pending' | 'generating' | 'done' | 'paused' | 'error';
    subtitleProgress: number; // 0-100
    subtitleStatusMsg?: string; // 动态状态信息（如：正在加载模型, 正在抽取音频等）
    subtitles?: SubtitleTrack[];
    activeSubtitleId?: string | null;
}

export interface PlayQueue {
    id: string;
    name: string;
    items: VideoItem[];
}

export interface QueueState {
    queues: PlayQueue[];
    activeQueueId: string;
    activeVideoIndex: number;

    addQueue: (name: string) => void;
    removeQueue: (id: string) => void;
    renameQueue: (id: string, name: string) => void;
    setActiveQueue: (id: string) => void;
    addVideo: (queueId: string, video: VideoItem) => void;
    removeVideo: (queueId: string, videoId: string) => void;
    reorderVideos: (queueId: string, fromIdx: number, toIdx: number) => void;
    setActiveVideoIndex: (index: number) => void;
    playNext: () => void;
    playPrev: () => void;
    getActiveVideo: () => VideoItem | null;
    updateVideoSubtitleStatus: (videoId: string, status: VideoItem['subtitleStatus'], progress?: number, msg?: string) => void;
    addSubtitleToVideo: (videoId: string, subtitle: SubtitleTrack) => void;
    setActiveSubtitleId: (videoId: string, subtitleId: string | null) => void;
    updateVideoDuration: (videoId: string, duration: number) => void;
    updateVideoTime: (videoId: string, time: number) => void;
}

const DEFAULT_QUEUE: PlayQueue = {
    id: 'default',
    name: '默认队列',
    items: [],
};

// Load persisted state
function loadQueues(): { queues: PlayQueue[]; activeQueueId: string; activeVideoIndex: number } {
    try {
        const stored = localStorage.getItem('aisubplayer-queues');
        if (stored) {
            const parsed = JSON.parse(stored);
            // 修复重启应用后，状态卡在 generating 导致无法读取本地字幕的问题
            if (parsed.queues) {
                parsed.queues.forEach((q: PlayQueue) => {
                    q.items.forEach((v: VideoItem) => {
                        if (v.subtitleStatus === 'generating' || v.subtitleStatus === 'pending') {
                            v.subtitleStatus = 'paused';
                            v.subtitleStatusMsg = '应用重启，已暂停';
                        }
                    });
                });
            }
            return parsed;
        }
    } catch { }
    return { queues: [DEFAULT_QUEUE], activeQueueId: 'default', activeVideoIndex: 0 };
}

function persistQueues(state: Pick<QueueState, 'queues' | 'activeQueueId' | 'activeVideoIndex'>) {
    localStorage.setItem('aisubplayer-queues', JSON.stringify({
        queues: state.queues,
        activeQueueId: state.activeQueueId,
        activeVideoIndex: state.activeVideoIndex,
    }));
}

export const useQueueStore = create<QueueState>((set, get) => {
    const initial = loadQueues();
    return {
        ...initial,

        addQueue: (name) => {
            const newQ: PlayQueue = { id: Date.now().toString(), name, items: [] };
            set((s) => {
                const next = { queues: [...s.queues, newQ], activeQueueId: s.activeQueueId, activeVideoIndex: s.activeVideoIndex };
                persistQueues(next);
                return next;
            });
        },

        removeQueue: (id) => set((s) => {
            const queues = s.queues.filter(q => q.id !== id);
            if (queues.length === 0) queues.push(DEFAULT_QUEUE);
            const activeQueueId = s.activeQueueId === id ? queues[0].id : s.activeQueueId;
            const next = { queues, activeQueueId, activeVideoIndex: 0 };
            persistQueues(next);
            return next;
        }),

        renameQueue: (id, name) => set((s) => {
            const queues = s.queues.map(q => q.id === id ? { ...q, name } : q);
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        setActiveQueue: (id) => set((s) => {
            const next = { ...s, activeQueueId: id, activeVideoIndex: 0 };
            persistQueues(next);
            return { activeQueueId: id, activeVideoIndex: 0 };
        }),

        addVideo: (queueId, video) => set((s) => {
            const queues = s.queues.map(q =>
                q.id === queueId ? { ...q, items: [...q.items, video] } : q
            );
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        removeVideo: (queueId, videoId) => set((s) => {
            const queues = s.queues.map(q =>
                q.id === queueId ? { ...q, items: q.items.filter(v => v.id !== videoId) } : q
            );
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        reorderVideos: (queueId, fromIdx, toIdx) => set((s) => {
            const queues = s.queues.map(q => {
                if (q.id !== queueId) return q;
                const items = [...q.items];
                const [moved] = items.splice(fromIdx, 1);
                items.splice(toIdx, 0, moved);
                return { ...q, items };
            });
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        setActiveVideoIndex: (index) => set((s) => {
            const next = { ...s, activeVideoIndex: index };
            persistQueues(next);
            return { activeVideoIndex: index };
        }),

        playNext: () => {
            const { queues, activeQueueId, activeVideoIndex } = get();
            const queue = queues.find(q => q.id === activeQueueId);
            if (!queue) return;
            if (activeVideoIndex < queue.items.length - 1) {
                const next = activeVideoIndex + 1;
                set({ activeVideoIndex: next });
                persistQueues({ ...get() });
            }
        },

        playPrev: () => {
            const { activeVideoIndex } = get();
            if (activeVideoIndex > 0) {
                const next = activeVideoIndex - 1;
                set({ activeVideoIndex: next });
                persistQueues({ ...get() });
            }
        },

        getActiveVideo: () => {
            const { queues, activeQueueId, activeVideoIndex } = get();
            const queue = queues.find(q => q.id === activeQueueId);
            if (!queue || !queue.items[activeVideoIndex]) return null;
            return queue.items[activeVideoIndex];
        },

        updateVideoSubtitleStatus: (videoId, status, progress, msg) => set((s) => {
            const queues = s.queues.map(q => ({
                ...q,
                items: q.items.map(v =>
                    v.id === videoId
                        ? {
                            ...v,
                            subtitleStatus: status,
                            subtitleProgress: progress ?? v.subtitleProgress,
                            subtitleStatusMsg: msg !== undefined ? msg : (status === 'error' || status === 'done' || status === 'none' ? undefined : v.subtitleStatusMsg)
                        }
                        : v
                ),
            }));
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        addSubtitleToVideo: (videoId, subtitle) => set((s) => {
            const queues = s.queues.map(q => ({
                ...q,
                items: q.items.map(v => {
                    if (v.id !== videoId) return v;
                    const subs = v.subtitles || [];
                    const newSubs = subs.some(x => x.id === subtitle.id) ? subs.map(x => x.id === subtitle.id ? subtitle : x) : [...subs, subtitle];
                    return { ...v, subtitles: newSubs, activeSubtitleId: subtitle.id };
                }),
            }));
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        setActiveSubtitleId: (videoId, subtitleId) => set((s) => {
            const queues = s.queues.map(q => ({
                ...q,
                items: q.items.map(v => v.id === videoId ? { ...v, activeSubtitleId: subtitleId } : v),
            }));
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        updateVideoDuration: (videoId, duration) => set((s) => {
            const queues = s.queues.map(q => ({
                ...q,
                items: q.items.map(v => v.id === videoId ? { ...v, duration } : v)
            }));
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),

        updateVideoTime: (videoId, time) => set((s) => {
            const queues = s.queues.map(q => ({
                ...q,
                items: q.items.map(v => v.id === videoId ? { ...v, currentTime: time } : v)
            }));
            const next = { ...s, queues };
            persistQueues(next);
            return { queues };
        }),
    };
});
