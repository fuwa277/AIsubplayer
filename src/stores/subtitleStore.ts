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
    cues: SubtitleCue[]; // 仍然保留供全量导出等场景快速访问
    cueMap: Record<string | number, SubtitleCue>; // O(1) 字典，用于解决渲染与状态更新灾难
    cueIds: (string | number)[]; // 顺序 ID 数组
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
    cueMap: {},
    cueIds: [],
    isVisible: true,
    isGenerating: false,
    generationProgress: 0,
    style: loadStyle(),

    setCues: (cues) => {
        const cueMap: Record<string | number, SubtitleCue> = {};
        const cueIds = cues.map(c => {
            cueMap[c.id] = c;
            return c.id;
        });
        set({ cues, cueMap, cueIds });
    },
    addCue: (cue) => set((s) => {
        const nextMap = { ...s.cueMap, [cue.id]: cue };
        const nextIds = [...s.cueIds, cue.id];
        return { 
            cues: [...s.cues, cue], 
            cueMap: nextMap, 
            cueIds: nextIds 
        };
    }),
    updateCue: (id, text, originalText) => set((s) => {
        const cue = s.cueMap[id];
        if (!cue) return s;
        // O(1) 直接更新字典对象，彻底摆脱耗时的 map 遍历
        const updatedCue = { ...cue, text, originalText: originalText !== undefined ? originalText : cue.originalText };
        const nextMap = { ...s.cueMap, [id]: updatedCue };
        // 维持 cues 数组用于给其他组件兼容消费
        const nextCues = s.cueIds.map(cid => nextMap[cid]);
        return { cueMap: nextMap, cues: nextCues };
    }),
    splitAndUpdateCue: (id, newText) => set((s) => {
        const cue = s.cueMap[id];
        if (!cue) return s;
        const parts = newText.split('\n').map(p => p.trim()).filter(Boolean);

        if (parts.length <= 1) {
            const updatedCue = { ...cue, text: newText.trim() };
            const nextMap = { ...s.cueMap, [id]: updatedCue };
            return { cueMap: nextMap, cues: s.cueIds.map(cid => nextMap[cid]) };
        }
        
        const idx = s.cueIds.indexOf(id);

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

        const nextIds = [...s.cueIds];
        const newIds = newCues.map(c => c.id);
        nextIds.splice(idx, 1, ...newIds);
        
        const nextMap = { ...s.cueMap };
        delete nextMap[id]; // 移除老的
        newCues.forEach(c => nextMap[c.id] = c);
        
        const nextCues = nextIds.map(cid => nextMap[cid]);
        return { cueIds: nextIds, cueMap: nextMap, cues: nextCues };
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
    clearCues: () => set({ cues: [], cueMap: {}, cueIds: [] }),
    getCurrentCue: (time) => {
        const { cues } = get();
        return cues.find(c => time >= c.startTime && time <= c.endTime) || null;
    },
}));
