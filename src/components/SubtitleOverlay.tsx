import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSubtitleStore } from '../stores/subtitleStore';
import { usePlayerStore } from '../stores/playerStore';

export const SubtitleOverlay: React.FC = () => {
    const { cues, isVisible, style } = useSubtitleStore();
    const { currentTime } = usePlayerStore();

    if (!isVisible) return null;

    const currentCue = cues.find(
        (c) => currentTime >= c.startTime && currentTime <= c.endTime
    );

    const positionClass =
        style.position === 'top'
            ? 'top-8'
            : style.position === 'center'
                ? 'top-1/2 -translate-y-1/2'
                : 'bottom-20';

    return (
        <div
            className={`absolute left-0 right-0 z-20 flex justify-center pointer-events-none px-8 ${positionClass}`}
        >
            <AnimatePresence mode="wait">
                {currentCue && (
                    <motion.div
                        key={currentCue.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="text-center px-4 py-2 rounded-lg max-w-[80%]"
                        style={{
                            backgroundColor: style.bgColor,
                            backdropFilter: 'blur(8px)',
                        }}
                    >
                        {/* Main translation text */}
                        <p
                            style={{
                                fontSize: `${style.fontSize}px`,
                                color: style.fontColor,
                                fontWeight: style.fontWeight,
                                lineHeight: 1.5,
                                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                            }}
                        >
                            {currentCue.text}
                        </p>
                        {/* Original text (bilingual) */}
                        {style.showBilingual && currentCue.originalText && (
                            <p
                                style={{
                                    fontSize: `${style.originalFontSize}px`,
                                    color: style.originalFontColor,
                                    lineHeight: 1.4,
                                    marginTop: '4px',
                                    textShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                }}
                            >
                                {currentCue.originalText}
                            </p>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
