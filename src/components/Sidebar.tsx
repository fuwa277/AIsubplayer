import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { List, Clock, RefreshCw } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { useSettingsStore } from '../stores/settingsStore';
import { QueuePanel } from './QueuePanel';
import { SubtitleTimeline } from './SubtitleTimeline';

type TabId = 'queue' | 'timeline';

interface SidebarProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const Sidebar: React.FC<SidebarProps> = ({ videoRef }) => {
    const [activeTab, setActiveTab] = useState<TabId>('queue');
    const [isBackendAlive, setIsBackendAlive] = useState(true);
    const [isRestarting, setIsRestarting] = useState(false);
    
    // 获取后端端口
    const port = useSettingsStore(s => s.backendPort) || 8000;

    // 心跳检测逻辑
    useEffect(() => {
        const checkHealth = async () => {
            try {
                // 设置 2 秒超时，防止 fetch 一直挂起
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 2000);
                const res = await fetch(`http://127.0.0.1:${port}/api/models`, { 
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(id);
                
                if (res.ok) {
                    setIsBackendAlive(true);
                } else {
                    setIsBackendAlive(false);
                }
            } catch (e) {
                setIsBackendAlive(false);
            }
        };

        checkHealth(); // 挂载时立即测一次
        const timer = setInterval(checkHealth, 5000); // 每 5 秒轮询一次
        return () => clearInterval(timer);
    }, [port]);

    // 一键唤醒处理函数
    const handleRestartBackend = async () => {
        if (isRestarting || isBackendAlive) return;
        setIsRestarting(true);
        try {
            console.log("[前端探针] 尝试重新拉起后端侧边车...");
            // 调用 Tauri 侧边车。注意：这里的 'aisubplayer-backend' 需与 tauri.conf.json 里的 externalBin 配置对应
            const cmd = Command.sidecar('aisubplayer-backend');
            await cmd.spawn();
            console.log("[前端探针] 侧边车启动指令已发送，等待心跳恢复...");
        } catch (error) {
            console.error("[前端探针] 唤醒后端失败:", error);
        } finally {
            // 无论成功失败，3秒后解除按钮的 Loading 状态，由心跳去接管状态指示
            setTimeout(() => setIsRestarting(false), 3000);
        }
    };

    const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
        { id: 'queue', label: '播放队列', icon: <List className="w-3.5 h-3.5" /> },
        { id: 'timeline', label: '字幕时间轴', icon: <Clock className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="h-full flex flex-col bg-[var(--color-bg-secondary)] border-l border-[var(--color-border)]">
            {/* Tab bar */}
            <div className="flex border-b border-[var(--color-border)]">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all relative ${activeTab === tab.id
                                ? 'text-[var(--color-accent)]'
                                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                        {activeTab === tab.id && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--color-accent)] rounded-full"
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0">
                <AnimatePresence mode="wait">
                    {activeTab === 'queue' ? (
                        <motion.div
                            key="queue"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            transition={{ duration: 0.15 }}
                            className="h-full"
                        >
                            <QueuePanel />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="timeline"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.15 }}
                            className="h-full"
                        >
                            <SubtitleTimeline videoRef={videoRef} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* 底部后端状态栏 */}
            <div className="h-10 border-t border-[var(--color-border)] px-3 flex items-center justify-between text-xs bg-[var(--color-bg-secondary)] shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full shadow-sm ${
                        isRestarting ? 'bg-yellow-400 animate-pulse' : 
                        isBackendAlive ? 'bg-green-500' : 'bg-red-500'
                    }`}></div>
                    <span className="text-[var(--color-text-secondary)] select-none">
                        {isRestarting ? '正在唤醒引擎...' : 
                         isBackendAlive ? 'AI 引擎在线' : 'AI 引擎已离线'}
                    </span>
                </div>
                
                {!isBackendAlive && !isRestarting && (
                    <button 
                        onClick={handleRestartBackend}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors border border-red-500/20"
                        title="点击重新启动后台推理服务"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="font-medium">一键唤醒</span>
                    </button>
                )}
            </div>
        </div>
    );
};
