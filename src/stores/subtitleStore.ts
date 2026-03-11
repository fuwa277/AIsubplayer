import { create } from 'zustand';

export interface WordTimestamp {
    start: number;
    end: number;
    word: string;
}

export interface SubtitleCue {
    id: string | number;
    startTime: number;
    endTime: number;
    text: string;
    originalText?: string; // original language for bilingual display
    words?: WordTimestamp[];
}

export interface SubtitleStyle {
    fontSize: number;
    fontColor: string;
    bgColor: string;
    position: 'bottom' | 'top' | 'center';
    fontWeight: string;
    // Bilingual specific
    showBilingual: boolean;
    originalFontSize: number;
    originalFontColor: string;
}

export interface SubtitleState {
    cues: SubtitleCue[];
    isVisible: boolean;
    isGenerating: boolean;
    generationProgress: number;
    style: SubtitleStyle;

    setCues: (cues: SubtitleCue[]) => void;
    addCue: (cue: SubtitleCue) => void;
    updateCue: (id: string | number, text: string, originalText?: string) => void;
    splitAndUpdateCue: (id: string | number, newText: string) => void;
    toggleVisible: () => void;
    setVisible: (v: boolean) => void;
    setGenerating: (g: boolean) => void;
    setGenerationProgress: (p: number) => void;
    setStyle: (style: Partial<SubtitleStyle>) => void;
    clearCues: () => void;
    getCurrentCue: (time: number) => SubtitleCue | null;
}

const defaultStyle: SubtitleStyle = {
    fontSize: 24,
    fontColor: '#ffffff',
    bgColor: 'rgba(0,0,0,0.6)',
    position: 'bottom',
    fontWeight: '500',
    showBilingual: true,
    originalFontSize: 16,
    originalFontColor: '#b0b0cc',
};

function loadStyle(): SubtitleStyle {
    try {
        const stored = localStorage.getItem('aisubplayer-subtitle-style');
        if (stored) return { ...defaultStyle, ...JSON.parse(stored) };
    } catch { }
    return defaultStyle;
}

export const useSubtitleStore = create<SubtitleState>((set, get) => ({
    cues: [],
    isVisible: true,
    isGenerating: false,
    generationProgress: 0,
    style: loadStyle(),

    setCues: (cues) => set({ cues }),
    addCue: (cue) => set((s) => ({ cues: [...s.cues, cue] })),
    updateCue: (id, text, originalText) => set((s) => ({
        cues: s.cues.map(c => c.id === id ? { ...c, text, originalText: originalText !== undefined ? originalText : c.originalText } : c),
    })),
    splitAndUpdateCue: (id, newText) => set((s) => {
        const idx = s.cues.findIndex(c => c.id === id);
        if (idx === -1) return s;
        const cue = s.cues[idx];
        const parts = newText.split('\n').map(p => p.trim()).filter(Boolean);

        if (parts.length <= 1) {
            const updatedCues = [...s.cues];
            updatedCues[idx] = { ...cue, text: newText.trim() };
            return { cues: updatedCues };
        }

        const newCues: SubtitleCue[] = [];
        const totalChars = parts.reduce((sum, p) => sum + p.length, 0);
        let currentTime = cue.startTime;

        if (cue.words && cue.words.length > 0) {
            let currentWordIdx = 0;
            parts.forEach((part, i) => {
                const partWords = [];
                let partTextLen = 0;
                while (currentWordIdx < cue.words!.length && partTextLen < part.length * 0.8) {
                    partWords.push(cue.words![currentWordIdx]);
                    partTextLen += cue.words![currentWordIdx].word.length;
                    currentWordIdx++;
                }
                const start = partWords.length > 0 ? partWords[0].start : currentTime;
                const end = partWords.length > 0
                    ? partWords[partWords.length - 1].end
                    : currentTime + (cue.endTime - cue.startTime) * (part.length / (totalChars || 1));

                newCues.push({
                    id: cue.id + '-' + i,
                    startTime: start,
                    endTime: end,
                    text: part,
                    words: partWords
                });
                currentTime = end;
            });
        } else {
            parts.forEach((part, i) => {
                const ratio = part.length / (totalChars || 1);
                const duration = (cue.endTime - cue.startTime) * ratio;
                newCues.push({
                    id: cue.id + '-' + i,
                    startTime: currentTime,
                    endTime: currentTime + duration,
                    text: part
                });
                currentTime += duration;
            });
        }

        const nextCues = [...s.cues];
        nextCues.splice(idx, 1, ...newCues);
        return { cues: nextCues };
    }),
    toggleVisible: () => set((s) => ({ isVisible: !s.isVisible })),
    setVisible: (v) => set({ isVisible: v }),
    setGenerating: (g) => set({ isGenerating: g }),
    setGenerationProgress: (p) => set({ generationProgress: p }),
    setStyle: (style) => {
        set((s) => {
            const next = { ...s.style, ...style };
            localStorage.setItem('aisubplayer-subtitle-style', JSON.stringify(next));
            return { style: next };
        });
    },
    clearCues: () => set({ cues: [] }),
    getCurrentCue: (time) => {
        const { cues } = get();
        return cues.find(c => time >= c.startTime && time <= c.endTime) || null;
    },
}));
