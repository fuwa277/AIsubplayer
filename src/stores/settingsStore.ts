import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';
export type InferenceDevice = 'auto' | 'gpu' | 'cpu' | 'cuda';

export interface ASRModel {
    id: string;
    name: string;
    size: string;
    downloaded: boolean;
    downloading: boolean;
    downloadProgress: number;
    downloadSpeed?: string;
    downloadError?: string;
}

export interface SettingsState {
    theme: ThemeMode;
    accentColor: string;
    bgColor: string;
    sidebarOpen: boolean;

    // ASR Settings
    sourceLanguage: string;
    targetLanguage: string;
    selectedModelId: string;
    availableModels: ASRModel[];

    // Performance
    batchSize: number;
    batchLength: number;
    inferenceDevice: InferenceDevice;
    computeType: 'default' | 'float16' | 'int8_float16' | 'float32' | 'int8';

    // Segmentation (断句)
    maxSegmentLength: number;
    minSilenceDuration: number;

    // VAD & Vocal
    vadEnabled: boolean;
    vocalIsolationEnabled: boolean;

    // Custom glossary
    customGlossaryPath: string;

    // Backend Connection
    backendPort: number;

    // CUDA Engine Status
    cudaEngineStatus: { ready: boolean, downloading: boolean, progress: number, speed: string, error: string } | null;

    // Test Connections State
    testingConnections: Record<string, 'testing' | 'ok' | 'fail' | null>;

    // Actions
    setTheme: (theme: ThemeMode) => void;
    toggleTheme: () => void;
    setAccentColor: (color: string) => void;
    setBgColor: (color: string) => void;
    setSidebarOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    setSourceLanguage: (lang: string) => void;
    setTargetLanguage: (lang: string) => void;
    setSelectedModelId: (id: string) => void;
    setAvailableModels: (models: ASRModel[]) => void;
    updateModelStatus: (id: string, updates: Partial<ASRModel>) => void;
    setBatchSize: (size: number) => void;
    setBatchLength: (length: number) => void;
    setInferenceDevice: (device: InferenceDevice) => void;
    setComputeType: (type: 'default' | 'float16' | 'int8_float16' | 'float32' | 'int8') => void;
    setMaxSegmentLength: (len: number) => void;
    setMinSilenceDuration: (dur: number) => void;
    setVadEnabled: (enabled: boolean) => void;
    setVocalIsolationEnabled: (enabled: boolean) => void;
    setCustomGlossaryPath: (path: string) => void;
    setBackendPort: (port: number) => void;
    setCudaEngineStatus: (status: any) => void;
    setTestingConnections: (updater: (prev: Record<string, 'testing' | 'ok' | 'fail' | null>) => Record<string, 'testing' | 'ok' | 'fail' | null>) => void;
    updateAll: (settings: Partial<SettingsState>) => void;
}

function loadSettings(): Partial<SettingsState> {
    try {
        const stored = localStorage.getItem('aisubplayer-settings');
        if (stored) return JSON.parse(stored);
    } catch { }
    return {};
}

function persistLocalSettings(state: Partial<SettingsState>) {
    // 1. 本地 LocalStorage 维持 CamelCase，保证前端逻辑一致性
    const localData = {
        theme: state.theme,
        accentColor: state.accentColor,
        bgColor: state.bgColor,
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        selectedModelId: state.selectedModelId,
        batchSize: state.batchSize,
        batchLength: state.batchLength,
        inferenceDevice: state.inferenceDevice,
        computeType: state.computeType,
        maxSegmentLength: state.maxSegmentLength,
        minSilenceDuration: state.minSilenceDuration,
        vadEnabled: state.vadEnabled,
        vocalIsolationEnabled: state.vocalIsolationEnabled,
        customGlossaryPath: state.customGlossaryPath,
        backendPort: state.backendPort,
    };
    localStorage.setItem('aisubplayer-settings', JSON.stringify(localData));

    // 2. 同步到后端时，必须映射为 Python Pydantic 兼容的 snake_case
    if (state.backendPort) {
        const backendData = {
            source_language: state.sourceLanguage,
            target_language: state.targetLanguage,
            batch_size: state.batchSize,
            batch_length: state.batchLength,
            inference_device: state.inferenceDevice,
            compute_type: state.computeType,
            max_segment_length: state.maxSegmentLength,
            vad_enabled: state.vadEnabled,
            vocal_isolation_enabled: state.vocalIsolationEnabled,
            custom_glossary_path: state.customGlossaryPath,
        };
        fetch(`http://127.0.0.1:${state.backendPort}/api/settings/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backendData)
        }).catch(() => { });
    }
}

const defaults = {
    theme: 'dark' as ThemeMode,
    accentColor: '#6366f1',
    bgColor: '#0f0f14',
    sidebarOpen: true,
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
    selectedModelId: 'large-v3',
    availableModels: [
        { id: 'tiny', name: 'Tiny', size: '72 MB', downloaded: false, downloading: false, downloadProgress: 0 },
        { id: 'base', name: 'Base', size: '139 MB', downloaded: false, downloading: false, downloadProgress: 0 },
        { id: 'small', name: 'Small', size: '461 MB', downloaded: false, downloading: false, downloadProgress: 0 },
        { id: 'medium', name: 'Medium', size: '1.42 GB', downloaded: false, downloading: false, downloadProgress: 0 },
        { id: 'large-v3', name: 'Large V3', size: '2.87 GB', downloaded: false, downloading: false, downloadProgress: 0 },
        { id: 'large-v3-turbo', name: 'Large V3 Turbo', size: '1.58 GB', downloaded: false, downloading: false, downloadProgress: 0 },
    ],
    batchSize: 32,
    batchLength: 30,
    inferenceDevice: 'auto' as InferenceDevice,
    computeType: 'default' as 'default' | 'float16' | 'int8_float16' | 'float32' | 'int8',
    maxSegmentLength: 80,
    minSilenceDuration: 0.5,
    vadEnabled: true,
    vocalIsolationEnabled: false,
    customGlossaryPath: '',
    backendPort: 8005,
};

export const useSettingsStore = create<SettingsState>((set, get) => {
    const saved = loadSettings();
    const initial = { ...defaults, ...saved };

    // Apply theme on load
    if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('light', initial.theme === 'light');
    }

    return {
        ...initial,
        // Keep default models list (downloaded status would come from backend)
        availableModels: defaults.availableModels,

        setTheme: (theme) => {
            document.documentElement.classList.toggle('light', theme === 'light');
            set({ theme });
            persistLocalSettings({ ...get(), theme });
        },
        toggleTheme: () => {
            const next = get().theme === 'dark' ? 'light' : 'dark';
            document.documentElement.classList.toggle('light', next === 'light');
            set({ theme: next });
            persistLocalSettings({ ...get(), theme: next });
        },
        setAccentColor: (accentColor) => { set({ accentColor }); persistLocalSettings({ ...get(), accentColor }); },
        setBgColor: (bgColor) => { set({ bgColor }); persistLocalSettings({ ...get(), bgColor }); },
        setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        setSourceLanguage: (sourceLanguage) => { set({ sourceLanguage }); persistLocalSettings({ ...get(), sourceLanguage }); },
        setTargetLanguage: (targetLanguage) => { set({ targetLanguage }); persistLocalSettings({ ...get(), targetLanguage }); },
        setSelectedModelId: (selectedModelId) => { set({ selectedModelId }); persistLocalSettings({ ...get(), selectedModelId }); },
        setAvailableModels: (availableModels) => set({ availableModels }),
        updateModelStatus: (id, updates) => set((s) => ({
            availableModels: s.availableModels.map(m => m.id === id ? { ...m, ...updates } : m),
        })),
        setBatchSize: (batchSize) => { set({ batchSize }); persistLocalSettings({ ...get(), batchSize }); },
        setBatchLength: (batchLength) => { set({ batchLength }); persistLocalSettings({ ...get(), batchLength }); },
        setInferenceDevice: (inferenceDevice) => { set({ inferenceDevice }); persistLocalSettings({ ...get(), inferenceDevice }); },
        setComputeType: (computeType) => { set({ computeType }); persistLocalSettings({ ...get(), computeType }); },
        setMaxSegmentLength: (maxSegmentLength) => { set({ maxSegmentLength }); persistLocalSettings({ ...get(), maxSegmentLength }); },
        setMinSilenceDuration: (minSilenceDuration) => { set({ minSilenceDuration }); persistLocalSettings({ ...get(), minSilenceDuration }); },
        setVadEnabled: (vadEnabled) => { set({ vadEnabled }); persistLocalSettings({ ...get(), vadEnabled }); },
        setVocalIsolationEnabled: (vocalIsolationEnabled) => { set({ vocalIsolationEnabled }); persistLocalSettings({ ...get(), vocalIsolationEnabled }); },
        setCustomGlossaryPath: (customGlossaryPath) => { set({ customGlossaryPath }); persistLocalSettings({ ...get(), customGlossaryPath }); },
        setBackendPort: (backendPort) => { set({ backendPort }); persistLocalSettings({ ...get(), backendPort }); },
        cudaEngineStatus: null,
        setCudaEngineStatus: (cudaEngineStatus) => set({ cudaEngineStatus }),
        testingConnections: {},
        setTestingConnections: (updater) => set(state => ({ testingConnections: updater(state.testingConnections as any) })),
        updateAll: (newSettings) => {
            set(newSettings);
            if (newSettings.theme) {
                document.documentElement.classList.toggle('light', newSettings.theme === 'light');
            }
            persistLocalSettings({ ...get(), ...newSettings });
        },
    };
});

// Kickoff initial backend load to overwrite potentially stale local storage
if (typeof window !== 'undefined') {
    setTimeout(async () => {
        const store = useSettingsStore.getState();
        try {
            const res = await fetch(`http://127.0.0.1:${store.backendPort}/api/settings/load`);
            if (res.ok) {
                const data = await res.json();
                if (data && Object.keys(data).length > 0) {
                    // Map snake_case from backend back to CamelCase for frontend
                    const mapped: any = {};
                    if (data.source_language) mapped.sourceLanguage = data.source_language;
                    if (data.target_language) mapped.targetLanguage = data.target_language;
                    if (data.batch_size) mapped.batchSize = data.batch_size;
                    if (data.batch_length) mapped.batchLength = data.batch_length;
                    if (data.inference_device) mapped.inferenceDevice = data.inference_device;
                    if (data.compute_type) mapped.computeType = data.compute_type;
                    if (data.max_segment_length) mapped.maxSegmentLength = data.max_segment_length;
                    if (data.vad_enabled !== undefined) mapped.vadEnabled = data.vad_enabled;
                    if (data.vocal_isolation_enabled !== undefined) mapped.vocalIsolationEnabled = data.vocal_isolation_enabled;
                    if (data.custom_glossary_path) mapped.customGlossaryPath = data.custom_glossary_path;

                    if (Object.keys(mapped).length > 0) {
                        store.updateAll(mapped);
                    }
                }
            }
        } catch (e) {
            console.log("Could not load backend settings on init, relying on local.");
        }
    }, 1000);
}
