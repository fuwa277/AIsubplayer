import { create } from 'zustand';

interface LogState {
    logs: string[];
    backendCrashed: boolean;
    addLog: (log: string) => void;
    clearLogs: () => void;
    setBackendCrashed: (v: boolean) => void;
}

export const useLogStore = create<LogState>((set) => ({
    logs: [],
    addLog: (log) => set((state) => {
        const next = [...state.logs, log];
        // 限制最大历史记录行数，防止内存泄漏
        return { logs: next.length > 1000 ? next.slice(next.length - 1000) : next };
    }),
    clearLogs: () => set({ logs: [] }),
    backendCrashed: false,
    setBackendCrashed: (v) => set({ backendCrashed: v })
}));
