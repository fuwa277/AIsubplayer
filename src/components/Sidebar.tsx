import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { List, Clock } from 'lucide-react';
import { QueuePanel } from './QueuePanel';
import { SubtitleTimeline } from './SubtitleTimeline';

type TabId = 'queue' | 'timeline';

interface SidebarProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const Sidebar: React.FC<SidebarProps> = ({ videoRef }) => {
    const [activeTab, setActiveTab] = useState<TabId>('queue');

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
        </div>
    );
};
