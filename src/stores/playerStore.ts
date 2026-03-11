import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;
    previousVolume: number;
    playbackRate: number;
    isFastForwarding: boolean;
    progressMap: Record<string, number>;

    setPlaying: (playing: boolean) => void;
    togglePlay: () => void;
    setCurrentTime: (time: number) => void;
    setDuration: (duration: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
    setPlaybackRate: (rate: number) => void;
    setFastForwarding: (ff: boolean) => void;
    saveProgress: (videoId: string, time: number) => void;
    getProgress: (videoId: string) => number;
}

export const usePlayerStore = create<PlayerState>()(
    persist(
        (set, get) => ({
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            volume: 0.8,
            isMuted: false,
            previousVolume: 0.8,
            playbackRate: 1,
            isFastForwarding: false,
            progressMap: {},

            setPlaying: (playing) => set({ isPlaying: playing }),
            togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
            setCurrentTime: (time) => set({ currentTime: time }),
            setDuration: (duration) => set({ duration }),
            setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
            toggleMute: () => {
                const { isMuted, volume, previousVolume } = get();
                if (isMuted) {
                    set({ isMuted: false, volume: previousVolume || 0.8 });
                } else {
                    set({ isMuted: true, previousVolume: volume, volume: 0 });
                }
            },
            setPlaybackRate: (rate) => set({ playbackRate: rate }),
            setFastForwarding: (ff) => set({ isFastForwarding: ff }),
            saveProgress: (videoId, time) => set((state) => ({
                progressMap: { ...state.progressMap, [videoId]: time }
            })),
            getProgress: (videoId) => get().progressMap[videoId] || 0,
        }),
        {
            name: 'aisubplayer-player',
            partialize: (state) => ({
                volume: state.volume,
                isMuted: state.isMuted,
                playbackRate: state.playbackRate,
                progressMap: state.progressMap,
            }),
        }
    )
);
