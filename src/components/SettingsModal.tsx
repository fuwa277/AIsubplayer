import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings2, Cpu, Type, Languages, Download, Trash2, Cpu as Gpu, Pause, Check, Terminal, Play } from 'lucide-react';
import { useSettingsStore, ASRModel } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useLogStore } from '../stores/logStore';
import { open } from '@tauri-apps/plugin-dialog';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabId = 'general' | 'model' | 'subtitle' | 'performance' | 'console';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<TabId>('general');
    const store = useSettingsStore();
    const subtitleStore = useSubtitleStore();

    const [draft, setDraft] = useState(() => ({
        sourceLanguage: store.sourceLanguage,
        targetLanguage: store.targetLanguage,
        theme: store.theme,
        accentColor: store.accentColor,
        vocalIsolationEnabled: store.vocalIsolationEnabled,
        vadEnabled: store.vadEnabled,
        customGlossaryPath: store.customGlossaryPath,
        inferenceDevice: store.inferenceDevice,
        batchSize: store.batchSize,
        batchLength: store.batchLength,
        maxSegmentLength: store.maxSegmentLength,
        computeType: store.computeType,
        backendPort: store.backendPort,
        selectedModelId: store.selectedModelId,
    }));

    const [styleDraft, setStyleDraft] = useState(() => ({ ...subtitleStore.style }));
    const [showSavedToast, setShowSavedToast] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setDraft({
                sourceLanguage: store.sourceLanguage,
                targetLanguage: store.targetLanguage,
                theme: store.theme,
                accentColor: store.accentColor,
                vocalIsolationEnabled: store.vocalIsolationEnabled,
                vadEnabled: store.vadEnabled,
                customGlossaryPath: store.customGlossaryPath,
                inferenceDevice: store.inferenceDevice,
                batchSize: store.batchSize,
                batchLength: store.batchLength,
                maxSegmentLength: store.maxSegmentLength,
                computeType: store.computeType,
                backendPort: store.backendPort,
                selectedModelId: store.selectedModelId,
            });
            setStyleDraft({ ...subtitleStore.style });
            setShowSavedToast(false);
        }
    }, [isOpen]); // Only reset draft when the modal is opened

    const handleSave = () => {
        store.updateAll(draft);
        subtitleStore.setStyle(styleDraft);
        setShowSavedToast(true);
        setTimeout(() => setShowSavedToast(false), 2000);
    };

    if (!isOpen) return null;

    const updateDraft = (key: string, value: any) => setDraft(prev => ({ ...prev, [key]: value }));
    const updateStyleDraft = (key: string, value: any) => setStyleDraft(prev => ({ ...prev, [key]: value }));

    const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
        { id: 'general', label: '常规设置', icon: <Settings2 className="w-4 h-4" /> },
        { id: 'model', label: 'AI模型管理', icon: <Cpu className="w-4 h-4" /> },
        { id: 'subtitle', label: '字幕外观', icon: <Type className="w-4 h-4" /> },
        { id: 'performance', label: '性能调优', icon: <Gpu className="w-4 h-4" /> },
        { id: 'console', label: '运行日志', icon: <Terminal className="w-4 h-4" /> },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            {/* 实时预览强调色（覆盖全局） */}
            <style>
                {`
                :root {
                  --user-accent: ${draft.accentColor};
                  --user-accent-hover: ${draft.accentColor}cc;
                }
                `}
            </style>
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-4xl h-[90vh] flex bg-[var(--color-bg-primary)] rounded-xl shadow-2xl overflow-hidden border border-[var(--color-border)]"
            >
                {/* Sidebar */}
                <div className="w-48 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] p-4 flex flex-col gap-2">
                    <h2 className="text-lg font-semibold mb-4 px-2 tracking-wide">应用设置</h2>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all flex-shrink-0 ${activeTab === tab.id
                                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col relative min-w-0">
                    {/* Toast Notification positioned absolute relative to screen */}
                    <AnimatePresence>
                        {showSavedToast && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, x: '-50%' }}
                                animate={{ opacity: 1, y: 0, x: '-50%' }}
                                exit={{ opacity: 0, y: -20, x: '-50%' }}
                                className="fixed top-8 left-1/2 bg-emerald-500 text-white px-5 py-2.5 rounded-full shadow-2xl z-[99999] text-sm flex items-center gap-2 pointer-events-none font-medium"
                            >
                                <Check className="w-4 h-4" /> 设置已保存
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] flex-shrink-0">
                        <h3 className="text-lg font-medium">{tabs.find(t => t.id === activeTab)?.label}</h3>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-white transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.15 }}
                            >
                                {activeTab === 'general' && <GeneralSettings draft={draft} onChange={updateDraft} />}
                                {activeTab === 'model' && <ModelSettings draft={draft} onChange={updateDraft} />}
                                {activeTab === 'subtitle' && <SubtitleSettings style={styleDraft} onChange={updateStyleDraft} />}
                                {activeTab === 'performance' && <PerformanceSettings draft={draft} onChange={updateDraft} />}
                                {activeTab === 'console' && <ConsoleSettings />}
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* Footer for save/cancel */}
                    <div className="p-4 border-t border-[var(--color-border)] flex justify-end items-center gap-3 bg-[var(--color-bg-secondary)] flex-shrink-0">
                        <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm bg-[var(--color-bg-tertiary)] hover:bg-black/10 transition-colors border border-transparent text-[var(--color-text-primary)]">
                            关闭面板
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={showSavedToast}
                            className={`px-5 py-2 rounded-lg text-sm text-white transition-all shadow-md ${showSavedToast ? 'bg-emerald-500 shadow-emerald-500/20 cursor-default' : 'bg-[var(--color-accent)] shadow-[var(--color-accent)]/20 hover:opacity-90'}`}
                        >
                            {showSavedToast ? '✓ 已保存' : '保存设置'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

// --- Tab Components ---

const GeneralSettings = ({ draft, onChange }: { draft: any, onChange: (k: string, v: any) => void }) => {
    return (
        <div className="space-y-8 max-w-xl">
            <Section title="语言与翻译">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                        label="视频源语言"
                        value={draft.sourceLanguage}
                        onChange={(e) => onChange('sourceLanguage', e.target.value)}
                        options={[
                            { value: 'auto', label: '自动检测 (Auto)' },
                            { value: 'en', label: '英语 (English)' },
                            { value: 'ja', label: '日语 (Japanese)' },
                            { value: 'zh', label: '中文 (Chinese)' },
                            { value: 'ko', label: '韩语 (Korean)' },
                        ]}
                    />
                    <Select
                        label="目标翻译语言"
                        value={draft.targetLanguage}
                        onChange={(e) => onChange('targetLanguage', e.target.value)}
                        options={[
                            { value: 'zh', label: '简体中文' },
                            { value: 'en', label: 'English' },
                            { value: 'none', label: '不翻译 (仅提取原文)' },
                        ]}
                    />
                </div>
            </Section>

            <Section title="外观主题">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                        label="深浅色模式"
                        value={draft.theme}
                        onChange={(e) => onChange('theme', e.target.value)}
                        options={[
                            { value: 'dark', label: '深色 (Dark)' },
                            { value: 'light', label: '浅色 (Light)' },
                        ]}
                    />
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                            强调色 (Accent Color)
                        </label>
                        <div className="flex gap-2">
                            {['#6366f1', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#0ea5e9'].map(color => (
                                <button
                                    key={color}
                                    onClick={() => onChange('accentColor', color)}
                                    className={`w-8 h-8 rounded-full border-2 transition-transform ${draft.accentColor === color ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'
                                        }`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </Section>

            <Section title="高级预处理">
                <div className="space-y-4">
                    <div className="opacity-50 pointer-events-none">
                        <Toggle
                            label="开启人声增强 (Vocal Isolation) - [敬请期待下一期版本]"
                            description="使用 AI 模型过滤复杂音乐和环境音，大幅减少因背景音导致的识别幻觉和乱码。后端配套 AI 管道正在加急开发中，敬请期待。"
                            checked={draft.vocalIsolationEnabled}
                            onChange={(v) => onChange('vocalIsolationEnabled', v)}
                        />
                    </div>
                    <Toggle
                        label="高精度VAD静音跳过 (模型已内置)"
                        description="当检测到无人说话时自动跳过该片段，极大节省显存资源并加快生成速度。轻量化 ONNX 运行库已自带于安装包，无需连接网络下载。"
                        checked={draft.vadEnabled}
                        onChange={(v) => onChange('vadEnabled', v)}
                    />
                </div>
            </Section>

            <Section title="自定义专属词库">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                        导入自定义TXT词典路径 (针对医学、游戏、二次元等专有名词)
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={draft.customGlossaryPath}
                            onChange={(e) => onChange('customGlossaryPath', e.target.value)}
                            placeholder="例如: D:\my_glossary.txt"
                            className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
                        />
                        <button
                            onClick={async () => {
                                try {
                                    const selected = await open({
                                        multiple: false,
                                        filters: [{ name: 'Text Files', extensions: ['txt'] }]
                                    });
                                    if (selected && typeof selected === 'string') {
                                        onChange('customGlossaryPath', selected);
                                    }
                                } catch (e) {
                                    console.error('Failed to open dialog:', e);
                                }
                            }}
                            className="px-4 py-2 text-sm bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
                        >
                            浏览
                        </button>
                    </div>
                </div>
            </Section>

            <Section title="后端服务配置">
                <div className="space-y-2 max-w-[200px]">
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)]">通信端口 (Backend Port)</label>
                    <input
                        type="number"
                        value={draft.backendPort}
                        onChange={(e) => onChange('backendPort', parseInt(e.target.value) || 8005)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)]"
                    />
                </div>
            </Section>
        </div>
    );
};

const ModelSettings = ({ draft, onChange }: { draft: any, onChange: (k: string, v: any) => void }) => {
    const store = useSettingsStore();
    const [backendReady, setBackendReady] = useState(false);
    const [sources, setSources] = useState<any[]>([]);
    const [currentSource, setCurrentSource] = useState('');

    // 之前用于测下载节点延迟的本地状态，如果需要持久也可迁移，目前先看影响最大的模型连接测试
    const [testingSource, setTestingSource] = useState(false);
    const [sourceResults, setSourceResults] = useState<any[]>([]);

    useEffect(() => {
        let mounted = true;
        const fetchModels = async () => {
            try {
                const res = await fetch(`http://127.0.0.1:${store.backendPort}/api/models/status`);
                if (!res.ok) { if (mounted) setBackendReady(false); return; }
                const data = await res.json();
                if (!mounted) return;
                setBackendReady(true);
                store.setCudaEngineStatus({
                    ready: data.cuda_engine_ready,
                    downloading: data.download_status?.cuda_engine?.downloading || false,
                    progress: data.download_status?.cuda_engine?.progress || 0,
                    speed: data.download_status?.cuda_engine?.speed || '',
                    error: data.download_status?.cuda_engine?.error || ''
                });

                store.availableModels.forEach(model => {
                    const isLocal = data.local_models.includes(model.id) || data.local_models.includes(`faster-whisper-${model.id}`);
                    const status = data.download_status?.[model.id];
                    let updates: Partial<ASRModel> = {};
                    if (status) {
                        updates = {
                            downloading: status.downloading,
                            downloadProgress: status.progress || 0,
                            downloadSpeed: status.speed || '',
                            downloadError: status.error || '',
                            downloaded: isLocal && status.progress === 100
                        };
                    } else {
                        updates = isLocal
                            ? { downloaded: true, downloading: false, downloadProgress: 100, downloadSpeed: '', downloadError: '' }
                            : { downloaded: false, downloading: false };
                    }
                    store.updateModelStatus(model.id, updates);
                });
            } catch (e) {
                if (mounted) setBackendReady(false);
            }
        };

        fetchModels();
        const interval = setInterval(fetchModels, 1000);
        return () => { mounted = false; clearInterval(interval); };
    }, [store.backendPort, store.availableModels.length]);

    // Fetch source list once backend is ready
    useEffect(() => {
        if (!backendReady) return;
        fetch(`http://127.0.0.1:${store.backendPort}/api/models/sources`)
            .then(r => r.json())
            .then(d => { setSources(d.sources || []); setCurrentSource(d.current || ''); })
            .catch(() => { });
    }, [backendReady, store.backendPort]);

    const handleTestSources = async () => {
        setTestingSource(true);
        setSourceResults([]);
        try {
            const res = await fetch(`http://127.0.0.1:${store.backendPort}/api/models/test_sources`, { method: 'POST' });
            const data = await res.json();
            setSourceResults(data.results || []);
        } catch (e) { }
        setTestingSource(false);
    };

    const handleSetSource = async (endpoint: string) => {
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/set_source`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
            });
            setCurrentSource(endpoint);
        } catch (e) { }
    };

    const handleDownload = async (modelId: string) => {
        // 立即更新 UI 状态，不等待 API 响应
        store.updateModelStatus(modelId, { downloading: true, downloadError: '', downloadProgress: 0 });
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
        } catch (e) {
            store.updateModelStatus(modelId, { downloading: false, downloadError: '无法连接后端' });
        }
    };

    const handlePause = async (modelId: string) => {
        // 立即更新 UI 
        store.updateModelStatus(modelId, { downloading: false, downloadSpeed: '暂停中...' });
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/pause`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
        } catch (e) {
            console.error(e);
        }
    };

    const handleTestConnection = async (modelId: string) => {
        store.setTestingConnections(prev => ({ ...prev, [modelId]: 'testing' }));
        try {
            const res = await fetch(`http://127.0.0.1:${store.backendPort}/api/models/test_connection`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            const data = await res.json();
            store.setTestingConnections(prev => ({ ...prev, [modelId]: data.ok ? 'ok' : 'fail' }));
            setTimeout(() => store.setTestingConnections(prev => ({ ...prev, [modelId]: null })), 4000);
        } catch (e) {
            store.setTestingConnections(prev => ({ ...prev, [modelId]: 'fail' }));
            setTimeout(() => store.setTestingConnections(prev => ({ ...prev, [modelId]: null })), 4000);
        }
    };

    const handleDelete = async (modelId: string) => {
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            store.updateModelStatus(modelId, { downloaded: false, downloadProgress: 0, downloading: false });
            if (draft.selectedModelId === modelId) {
                store.setSelectedModelId('large-v3');
                onChange('selectedModelId', 'large-v3');
            }
        } catch (e) {
            console.error(e);
        }
    };

    const openModelFolder = async () => {
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/open_folder`, { method: 'POST' });
        } catch (e) {
            console.error("Failed to open model folder", e);
        }
    };

    const handleDownloadCuda = async () => {
        store.setCudaEngineStatus({ ...store.cudaEngineStatus, downloading: true, error: '', progress: 0 });
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/cuda/download`, { method: 'POST' });
        } catch (e) {
            store.setCudaEngineStatus({ ...store.cudaEngineStatus, downloading: false, error: '连接后端失败' });
        }
    };

    const handlePauseCuda = async () => {
        store.setCudaEngineStatus({ ...store.cudaEngineStatus, downloading: false, speed: '暂停中...' });
        try {
            await fetch(`http://127.0.0.1:${store.backendPort}/api/models/cuda/pause`, { method: 'POST' });
        } catch (e) { }
    };

    return (
        <div className="space-y-6">
            {/* Backend status banner */}
            {!backendReady && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                    后端启动中，请稍候...（约 5-10 秒）
                </div>
            )}

            {/* Download source selector */}
            {backendReady && (
                <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">下载源选择</h4>
                            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">选择延迟最低的源以获得最快下载速度</p>
                        </div>
                        <button
                            onClick={handleTestSources}
                            disabled={testingSource}
                            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-50"
                        >
                            {testingSource ? '测试中...' : '🔍 测速'}
                        </button>
                    </div>
                    <div className="space-y-2">
                        {(sources.length > 0 ? sources : [
                            { id: 'hf-mirror', name: 'HF Mirror', desc: '中国大陆推荐', endpoint: 'https://hf-mirror.com' },
                            { id: 'aliendao', name: 'AlienDAO', desc: '备用镜像', endpoint: 'https://aliendao.cn' },
                            { id: 'huggingface', name: 'HuggingFace 官方', desc: '海外用户', endpoint: 'https://huggingface.co' },
                        ]).map((src: any) => {
                            const result = sourceResults.find((r: any) => r.endpoint === src.endpoint);
                            const isActive = currentSource === src.endpoint || (!currentSource && src.id === 'hf-mirror');
                            const bestLatency = sourceResults.filter((r: any) => r.ok).reduce((min: number, r: any) => Math.min(min, r.latency_ms), Infinity);
                            const isBest = result?.ok && result?.latency_ms === bestLatency && isFinite(bestLatency);
                            return (
                                <button
                                    key={src.id}
                                    onClick={() => handleSetSource(src.endpoint)}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all ${isActive
                                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40 bg-[var(--color-bg-tertiary)]/40'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />
                                        <div>
                                            <span className="text-sm font-medium text-[var(--color-text-primary)]">{src.name}</span>
                                            <span className="text-xs text-[var(--color-text-secondary)] ml-2">{src.desc}</span>
                                        </div>
                                        {isBest && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">推荐</span>}
                                    </div>
                                    <div className="text-xs font-mono flex-shrink-0">
                                        {testingSource ? (
                                            <span className="text-[var(--color-text-secondary)] animate-pulse">...</span>
                                        ) : result ? (
                                            result.ok
                                                ? <span className="text-emerald-400">{result.latency_ms}ms</span>
                                                : <span className="text-red-400">✗</span>
                                        ) : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="flex justify-end mb-2">
                <button
                    onClick={openModelFolder}
                    className="text-sm px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-sm transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                    📁 打开本地模型文件夹
                </button>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex gap-3">
                <div className="mt-0.5"><Languages className="w-5 h-5 text-emerald-500" /></div>
                <div>
                    <h4 className="text-sm font-medium text-emerald-500 mb-1">推荐使用 Large V3 Turbo</h4>
                    <p className="text-xs text-emerald-500/80 leading-relaxed">
                        该模型在保证极高识别率和翻译质量的同时，大幅优化了推理速度，适合拥有6GB以上显存的用户。
                        建议网络环境不佳的用户，可以通过上方按钮打开模型存放目录，自行解压下载的模型。
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                {store.availableModels.map(model => (
                    <div
                        key={model.id}
                        onClick={() => {
                            store.setSelectedModelId(model.id);
                            onChange('selectedModelId', model.id);
                        }}
                        className={`p-4 rounded-xl border transition-all flex items-center justify-between cursor-pointer select-none ${draft.selectedModelId === model.id
                            ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50 ring-1 ring-[var(--color-accent)]/30'
                            : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-tertiary)]/40'
                            }`}
                    >
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">{model.name}</span>
                                {draft.selectedModelId === model.id && (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] text-white ${model.downloaded ? 'bg-[var(--color-accent)]' : 'bg-amber-500'
                                        }`}>
                                        {model.downloaded ? '当前选中' : '已选中 (待下载)'}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                                需下载大小: {model.size} | 显存建议: {
                                    model.id === 'tiny' ? '2GB+' :
                                        model.id.includes('large') ? '6GB+' : '4GB+'
                                }
                            </p>
                        </div>

                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {model.downloading ? (
                                <div className="flex flex-col items-end gap-1 w-32">
                                    <div className="flex justify-between w-full text-[10px] px-1">
                                        <span className="text-[var(--color-text-secondary)] truncate max-w-[80px]">{model.downloadSpeed || '连接中...'}</span>
                                        <span className="text-[var(--color-accent)] font-medium font-mono">{Number(model.downloadProgress || 0).toFixed(1)}%</span>
                                    </div>
                                    <div className="w-full flex items-center justify-between gap-1.5">
                                        <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                                            <div className="h-full bg-[var(--color-accent)] transition-all duration-500" style={{ width: `${model.downloadProgress}%` }} />
                                        </div>
                                        <button
                                            onClick={() => handlePause(model.id)}
                                            className="p-1 rounded text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-bg-tertiary)] transition-colors flex-shrink-0"
                                            title="暂停下载"
                                        >
                                            <Pause className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ) : model.downloaded ? (
                                <>
                                    <button
                                        onClick={() => handleDelete(model.id)}
                                        className="p-2 rounded-lg text-red-400 hover:bg-red-400/10 transition-colors"
                                        title="卸载模型"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    {/* 连接测试按钮 */}
                                    <button
                                        onClick={() => handleTestConnection(model.id)}
                                        disabled={store.testingConnections[model.id] === 'testing'}
                                        className={`p-1.5 rounded-lg border text-xs transition-all ${store.testingConnections[model.id] === 'ok' ? 'border-green-400 text-green-400 bg-green-400/10' :
                                            store.testingConnections[model.id] === 'fail' ? 'border-red-400 text-red-400 bg-red-400/10' :
                                                store.testingConnections[model.id] === 'testing' ? 'border-[var(--color-border)] text-[var(--color-text-secondary)] animate-pulse' :
                                                    'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
                                            }`}
                                        title={store.testingConnections[model.id] === 'ok' ? '连接正常' : store.testingConnections[model.id] === 'fail' ? '无法连接' : '测试与下载服务器的连接'}
                                    >
                                        {store.testingConnections[model.id] === 'ok' ? '✓' :
                                            store.testingConnections[model.id] === 'fail' ? '✗' :
                                                store.testingConnections[model.id] === 'testing' ? '...' : '🌐'}
                                    </button>
                                    {model.downloadError && <span className="text-[10px] text-red-400 max-w-[60px] truncate" title={model.downloadError}>{model.downloadError}</span>}
                                    <button
                                        onClick={() => handleDownload(model.id)}
                                        className="px-3 py-1.5 text-sm rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
                                    >
                                        <Download className="w-4 h-4" />
                                        {model.downloadProgress > 0 && model.downloadProgress < 100 ? '续传' : '下载'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* CUDA Engine Download Section */}
            <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
                <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">NVIDIA CUDA 核心加速依赖库</h4>
                <p className="text-xs text-[var(--color-text-secondary)] mb-3 leading-relaxed">
                    若您的系统未安装完整版 CUDA Toolkit 或运行报错 <code>cublas64_12.dll is not found</code>，请务必下载此运行库以启用 GPU 加速。
                </p>

                <div className={`p-4 rounded-xl border transition-all flex items-center justify-between ${store.cudaEngineStatus?.ready
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/30'
                    }`}>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`font-medium ${store.cudaEngineStatus?.ready ? 'text-emerald-400' : 'text-amber-400'}`}>
                                CTranslate2 CUDA12 Engine
                            </span>
                            {store.cudaEngineStatus?.ready && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500 text-white">已就绪</span>
                            )}
                        </div>
                        <p className={`text-xs ${store.cudaEngineStatus?.ready ? 'text-emerald-500/80' : 'text-amber-500/80'}`}>
                            包含 nvidia-cublas-cu12 与 nvidia-cudnn-cu12 (约 650 MB)
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {store.cudaEngineStatus?.downloading ? (
                            <div className="flex flex-col items-end gap-1 w-32">
                                <div className="flex justify-between w-full text-[10px] px-1">
                                    <span className="text-[var(--color-text-secondary)] truncate max-w-[80px]">
                                        {store.cudaEngineStatus.speed || '连接中...'}
                                    </span>
                                    <span className="text-amber-400 font-medium font-mono">
                                        {Number(store.cudaEngineStatus.progress || 0).toFixed(1)}%
                                    </span>
                                </div>
                                <div className="w-full flex items-center justify-between gap-1.5">
                                    <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden border border-amber-500/20">
                                        <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${store.cudaEngineStatus.progress}%` }} />
                                    </div>
                                    <button
                                        onClick={handlePauseCuda}
                                        className="p-1 rounded text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-bg-tertiary)] transition-colors flex-shrink-0"
                                        title="暂停下载"
                                    >
                                        <Pause className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : store.cudaEngineStatus?.ready ? (
                            <span className="text-xs text-emerald-400 opacity-80 italic">无需重复下载</span>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                {store.cudaEngineStatus?.error && (
                                    <span className="text-[10px] text-red-400 max-w-[80px] truncate" title={store.cudaEngineStatus.error}>
                                        {store.cudaEngineStatus.error}
                                    </span>
                                )}
                                <button
                                    onClick={handleDownloadCuda}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm shadow-amber-500/20"
                                >
                                    <Download className="w-4 h-4" />
                                    {store.cudaEngineStatus?.progress && store.cudaEngineStatus.progress > 0 ? '继续下载 DLL' : '一键下载依赖'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const SubtitleSettings = ({ style, onChange }: { style: any, onChange: (k: string, v: any) => void }) => {
    return (
        <div className="space-y-8 max-w-xl">
            {/* Preview box */}
            <div className="mb-6 bg-[url('https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=800&auto=format&fit=crop')] bg-cover bg-center h-48 rounded-xl relative overflow-hidden flex items-center justify-center shadow-inner">
                <div className="absolute inset-0 bg-black/40" />
                <div
                    className="relative text-center px-4 py-2 rounded-lg max-w-[80%]"
                    style={{ backgroundColor: style.bgColor, backdropFilter: 'blur(8px)' }}
                >
                    <p style={{ fontSize: `${style.fontSize}px`, color: style.fontColor, fontWeight: style.fontWeight, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                        这是一段实时生成的AI字幕。
                    </p>
                    {style.showBilingual && (
                        <p style={{ fontSize: `${style.originalFontSize}px`, color: style.originalFontColor, marginTop: '4px', textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                            This is a real-time AI generated subtitle.
                        </p>
                    )}
                </div>
            </div>

            <Section title="主字幕样式 (译文)">
                <div className="grid gap-6 sm:grid-cols-2">
                    <Range
                        label="字体大小: {v}px"
                        min={14} max={48} step={1}
                        value={style.fontSize}
                        onChange={(v) => onChange('fontSize', v)}
                    />
                    <Select
                        label="显示位置"
                        value={style.position}
                        onChange={(e) => onChange('position', e.target.value)}
                        options={[
                            { value: 'bottom', label: '底部 (推荐)' },
                            { value: 'top', label: '顶部' },
                            { value: 'center', label: '正中' },
                        ]}
                    />
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">字体颜色与背景色</label>
                        <div className="flex gap-2">
                            <input
                                type="color"
                                value={style.fontColor}
                                onChange={(e) => onChange('fontColor', e.target.value)}
                                className="w-8 h-8 rounded-xl cursor-pointer p-0 border-2 border-[var(--color-border)] bg-transparent outline-none overflow-hidden shrink-0 hover:scale-105 transition-transform [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-xl [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-xl"
                            />
                            <Select
                                label=""
                                value={style.bgColor}
                                onChange={(e) => onChange('bgColor', e.target.value)}
                                options={[
                                    { value: 'transparent', label: '无背景' },
                                    { value: 'rgba(0,0,0,0.4)', label: '轻度黑底' },
                                    { value: 'rgba(0,0,0,0.6)', label: '标准黑底' },
                                    { value: 'rgba(0,0,0,0.8)', label: '重度黑底' },
                                ]}
                            />
                        </div>
                    </div>
                </div>
            </Section>

            <Section title="双语对照设置">
                <div className="space-y-4">
                    <Toggle
                        label="显示原文对照 (Bilingual Display)"
                        description="开启后，将在译文下方以小字号显示视频原文。"
                        checked={style.showBilingual}
                        onChange={(v) => onChange('showBilingual', v)}
                    />
                    {style.showBilingual && (
                        <div className="grid gap-6 sm:grid-cols-2 p-4 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)]">
                            <Range
                                label="原文字号: {v}px"
                                min={10} max={32} step={1}
                                value={style.originalFontSize}
                                onChange={(v) => onChange('originalFontSize', v)}
                            />
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">原文颜色</label>
                                <input
                                    type="color"
                                    value={style.originalFontColor}
                                    onChange={(e) => onChange('originalFontColor', e.target.value)}
                                    className="w-8 h-8 rounded-xl cursor-pointer p-0 border-2 border-[var(--color-border)] bg-transparent outline-none overflow-hidden hover:scale-105 transition-transform [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-xl [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-xl"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </Section>
        </div>
    );
};

const PerformanceSettings = ({ draft, onChange }: { draft: any, onChange: (k: string, v: any) => void }) => {
    const store = useSettingsStore();
    const [stats, setStats] = useState<any>(null);
    const [isPolling, setIsPolling] = useState(false);

    useEffect(() => {
        let mounted = true;
        const fetchStats = async () => {
            try {
                const res = await fetch(`http://127.0.0.1:${store.backendPort}/api/system/stats`);
                if (!res.ok) throw new Error("API not ok");
                const data = await res.json();
                if (mounted) {
                    setStats(data);
                    setIsPolling(true);
                }
            } catch (e) {
                if (mounted) setIsPolling(false);
            }
        };

        fetchStats();
        const interval = setInterval(fetchStats, 2000);
        return () => {
            mounted = false;
            clearInterval(interval);
        }
    }, [store.backendPort]);

    return (
        <div className="space-y-8 max-w-xl">
            {/* Mini Performance Monitor Component */}
            <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-border)] shadow-inner text-xs font-mono">
                <div className="flex items-center justify-between mb-3 text-[var(--color-text-secondary)]">
                    <span className="font-semibold text-[var(--color-text-primary)]">硬件性能监控 (后端通信)</span>
                    <span className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${isPolling ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                        {isPolling ? 'Live Data' : 'Disconnected'}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between mb-1 text-[var(--color-text-primary)]">
                            <span className="truncate pr-2">{stats?.gpus?.[0]?.name || 'GPU 未识别'}</span>
                            <span className="text-amber-500 shrink-0">{stats ? `${stats.gpus?.[0]?.usage_percent || 0}%` : '--'}</span>
                        </div>
                        <div className="h-1 bg-[var(--color-border)] rounded-full mb-1"><div className="h-full bg-amber-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${stats?.gpus?.[0]?.usage_percent || 0}%` }} /></div>
                        {stats && stats.gpus && stats.gpus.length > 0 ? (
                            <div className="mt-1 text-[var(--color-text-secondary)] truncate">
                                RAM: {stats.gpus[0].vram_used_gb.toFixed(1)}GB / {stats.gpus[0].vram_total_gb.toFixed(1)}GB
                                <div className="h-1 bg-[var(--color-border)] rounded-full mt-1.5 inline-block w-full"><div className="h-full bg-amber-600 rounded-full transition-all duration-500 ease-out" style={{ width: `${stats.gpus[0].vram_percent}%` }} /></div>
                            </div>
                        ) : <div className="mt-1 text-[var(--color-text-secondary)]">需 NVIDIA 驱动支持</div>}
                    </div>
                    <div>
                        <div className="flex justify-between mb-1 text-[var(--color-text-primary)]">
                            <span>CPU 统筹占用</span>
                            <span className="text-emerald-500">{stats ? `${stats.cpu_usage_percent.toFixed(1)}%` : '--'}</span>
                        </div>
                        <div className="h-1 bg-[var(--color-border)] rounded-full mb-1"><div className="h-full bg-emerald-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${stats?.cpu_usage_percent || 0}%` }} /></div>
                        {stats && (
                            <div className="mt-1 text-[var(--color-text-secondary)] truncate">
                                RAM: {stats.ram_used_gb.toFixed(1)}GB / {stats.ram_total_gb.toFixed(1)}GB
                                <div className="h-1 bg-[var(--color-border)] rounded-full mt-1.5 inline-block w-full"><div className="h-full bg-emerald-600 rounded-full transition-all duration-500 ease-out" style={{ width: `${stats.ram_usage_percent}%` }} /></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Section title="推理引擎">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col">
                        <Select
                            label="计算设备"
                            value={draft.inferenceDevice}
                            onChange={(e) => onChange('inferenceDevice', e.target.value)}
                            options={[
                                { value: 'auto', label: '自动选择 (推荐)' },
                                { value: 'cuda', label: 'NVIDIA GPU (CUDA)' },
                                { value: 'gpu', label: 'DirectML / 其他 GPU' },
                                { value: 'cpu', label: '仅限 CPU (极慢)' },
                            ]}
                        />
                        {stats?.cuda_support && (
                            <div className="mt-2 text-xs flex items-center gap-1.5 p-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
                                <div className={`w-2 h-2 rounded-full ${stats.cuda_support.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                <span className={stats.cuda_support.available ? 'text-emerald-400 font-medium' : 'text-red-400'}>
                                    {stats.cuda_support.available ? `CUDA 加速就绪 (${stats.cuda_support.device_name})` : '未检测到 CUDA 环境，将退化为 CPU 计算'}
                                </span>
                            </div>
                        )}
                        {(!stats || !stats.cuda_support) && (
                            <div className="mt-2 text-[10px] text-[var(--color-text-secondary)] italic">
                                正在检测系统硬件支持中...
                            </div>
                        )}
                        {/* 依赖说明提示 */}
                        {draft.inferenceDevice === 'cuda' && stats?.cuda_support && stats.cuda_support.available && !store.cudaEngineStatus?.ready && (
                            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                <div className="flex items-start gap-2 text-amber-500">
                                    <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0 animate-pulse" />
                                    <div>
                                        <p className="text-[11px] font-medium mb-0.5">可能需要依赖运行包</p>
                                        <p className="text-[10px] opacity-80 leading-relaxed">
                                            尽管检测到了显卡，但该模式仍需 NVIDIA cuBLAS 与 cuDNN 支持。如果您在推理自检时遇到报错，请前往 <b>“AI模型管理”</b> 面板底部下载核心加速引擎库。
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                        {draft.inferenceDevice === 'cuda' && stats?.cuda_support && !stats.cuda_support.available && (
                            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <div className="flex items-start gap-2 text-red-400">
                                    <X className="w-4 h-4 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-[11px] font-medium mb-0.5">未检测到 CUDA GPU</p>
                                        <p className="text-[10px] opacity-75">请确认安装了 NVIDIA 驱动，将耀退化为 CPU 计算。</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col">
                        <Select
                            label="计算精度 (影响性能/兼容性)"
                            value={draft.computeType}
                            onChange={(e) => onChange('computeType', e.target.value)}
                            options={[
                                { value: 'default', label: '默认 (由引擎根据设备自动决定)' },
                                { value: 'float16', label: '16位浮点 (高兼容, GPU推荐)' },
                                { value: 'float32', label: '32位浮点 (解决部分旧卡不兼容)' },
                                { value: 'int8_float16', label: 'INT8+FP16 (省显存, 提速)' },
                                { value: 'int8', label: '纯 INT8 量化 (最省显存, 稍低精)' },
                            ]}
                        />
                        {stats?.cuda_support && stats.cuda_support.supported_types && stats.cuda_support.supported_types.length > 0 && (
                            <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
                                该设备官方支持: {stats.cuda_support.supported_types.join(', ')}
                            </div>
                        )}
                    </div>
                </div>
                {/* 测试推理引擎 */}
                <TestInferenceButton draft={draft} />
            </Section>

            <Section title="硬件限制与优化 (防崩溃)">
                <div className="space-y-6">
                    <Range
                        label="音频切片大小 (Audio Chunk Size): {v} MB"
                        description="每次提取特征并送入模型的片段大小。建议: 16-32MB (低显存如4GB), 30-50MB (6GB+显存)。越大数据处理越快但显存增加。"
                        min={10} max={200} step={2}
                        value={draft.batchSize}
                        onChange={(v) => onChange('batchSize', v)}
                    />
                    <Range
                        label="音频片段时长 (Audio Chunk Seconds): {v} 秒"
                        description="单次送入模型的片段长度上限。建议: 15-30秒 (低显存), 30-60秒 (8GB+)。过长易导致显存溢出 (OOM)。"
                        min={10} max={120} step={5}
                        value={draft.batchLength}
                        onChange={(v) => onChange('batchLength', v)}
                    />
                    <Range
                        label="最大断句长度 (字/词): {v}"
                        description="超过此长度强制换行，以防单句过长填满屏幕。"
                        min={20} max={120} step={5}
                        value={draft.maxSegmentLength}
                        onChange={(v) => onChange('maxSegmentLength', v)}
                    />
                </div>
            </Section>
        </div>
    );
};

// --- Reusable Form Components ---

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <h4 className="text-sm font-semibold text-[var(--color-accent)] mb-4">{title}</h4>
        {children}
    </div>
);

const Select: React.FC<{ label: string; value: string; onChange: (e: any) => void; options: { value: string; label: string }[] }> = ({ label, value, onChange, options }) => (
    <div className="space-y-1.5 min-w-0">
        {label && <label className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>}
        <select
            value={value}
            onChange={onChange}
            className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] cursor-pointer text-[var(--color-text-primary)]"
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    </div>
);

const Toggle: React.FC<{ label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, description, checked, onChange }) => (
    <label className="flex items-start gap-3 cursor-pointer group" onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
        <div className={`mt-0.5 w-11 h-6 rounded-full relative transition-colors duration-300 flex-shrink-0 border ${checked ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border)]'}`}>
            <div className={`absolute top-[1px] left-[1px] w-5 h-5 bg-white rounded-full transition-transform duration-300 shadow-sm ${checked ? 'translate-x-[20px]' : 'translate-x-[0px] opacity-80'}`} />
        </div>
        <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">{label}</div>
            {description && <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{description}</div>}
        </div>
    </label>
);

const Range: React.FC<{ label: string; description?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }> = ({ label, description, min, max, step, value, onChange }) => (
    <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
            {label.replace('{v}', value.toString())}
        </label>
        {description && <p className="text-xs text-[var(--color-text-secondary)]/70">{description}</p>}
        <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full"
        />
    </div>
);

const ConsoleSettings = () => {
    const { logs, clearLogs } = useLogStore();
    const bottomRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="flex flex-col h-[500px] bg-[#0a0a0c] text-[#a1a1aa] font-mono text-xs rounded-xl border border-[var(--color-border)] p-4 overflow-hidden relative shadow-inner">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-white/5 flex-shrink-0">
                <span className="font-semibold flex items-center gap-2"><Terminal className="w-4 h-4 text-[var(--color-accent)]" /> Backend Console</span>
                <button onClick={clearLogs} className="px-3 py-1 bg-white/5 rounded-md hover:bg-white/10 transition-colors text-white/70 hover:text-white">清空日志</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pb-2 pr-2 select-text">
                {logs.length === 0 ? <div className="text-center text-white/30 italic mt-10 tracking-widest">等待日志输出...</div> : logs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all">{log}</div>
                ))}
                <div ref={bottomRef} />
            </div>
            <style>{`
            .custom-scrollbar::-webkit-scrollbar { width: 6px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
            `}</style>
        </div>
    );
};

const TestInferenceButton = ({ draft }: { draft: any }) => {
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const handleTest = async () => {
        setTesting(true);
        setResult("正在进行引擎空载测试... (确保你的参数均已由右上角保存过)");
        try {
            const res = await fetch(`http://127.0.0.1:${draft.backendPort}/api/test_inference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    video_path: "test",
                    model_id: draft.selectedModelId,
                    inference_device: draft.inferenceDevice,
                    compute_type: draft.computeType
                })
            });
            const data = await res.json();
            setResult(data.status === 'success' ? `✅ ${data.message}` : `❌ ${data.message}`);
        } catch (e: any) {
            setResult(`❌ 后端连接失败: ${e.message}。请到运行日志面板查看详细堆栈崩溃线索。`);
        }
        setTesting(false);
    };

    return (
        <div className="mt-4 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-secondary)] shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <h5 className="text-sm font-medium">前向推理自检 (测试预热)</h5>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">生成短暂的无声数据并在你当前设定的硬件、模型精度上强制跑一轮，以验证组合是否兼容。</p>
                </div>
                <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex shrink-0 items-center justify-center gap-2 px-4 py-2 bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/20 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {testing ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                    {testing ? '测试进行中' : '发送自检信号'}
                </button>
            </div>
            {result && (
                <div className={`mt-3 p-2.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap font-mono ${result.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                    {result}
                </div>
            )}
        </div>
    );
};
