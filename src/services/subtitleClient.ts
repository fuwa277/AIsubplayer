import { useSubtitleStore } from '../stores/subtitleStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { writeTextFile } from '@tauri-apps/plugin-fs';

class SubtitleClient {
    private wsMap = new Map<string, WebSocket>();

    public async generate(videoId: string, videoPath: string, trackId: string) {
        // Disconnect previous for this specific video if exists
        this.stop(videoId);

        const settings = useSettingsStore.getState();
        const queueStore = useQueueStore.getState();
        const subStore = useSubtitleStore.getState();

        // Mark starting
        queueStore.updateVideoSubtitleStatus(videoId, 'generating', 0);
        subStore.clearCues(); // We'll stream new cues into the store

        const wsUrl = `ws://127.0.0.1:${settings.backendPort}/api/ws/transcribe/${videoId}`;
        const ws = new WebSocket(wsUrl);
        this.wsMap.set(videoId, ws);

        ws.onopen = () => {
            console.log("WebSocket linked to backend.");
            // Send config to backend right after connection
            const config = {
                video_path: videoPath,
                model_id: settings.selectedModelId,
                source_language: settings.sourceLanguage,
                target_language: settings.targetLanguage, // TODO on backend
                vad_enabled: settings.vadEnabled,
                vocal_isolation_enabled: settings.vocalIsolationEnabled,
                custom_glossary_path: settings.customGlossaryPath || null,
                inference_device: settings.inferenceDevice,
                compute_type: settings.computeType || 'default',
                batch_size: settings.batchSize,
                batch_length: settings.batchLength,
                max_segment_length: settings.maxSegmentLength,
                word_timestamps: true, // Force enabled since UI wants to support hit-ENTER to split
                remove_punctuation: false // TBD expose setting if requested
            };
            ws.send(JSON.stringify(config));
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'subtitle_chunk') {
                    const chunk = message.data;
                    // chunk matched the Pydantic schema SubtitleSegment
                    // mapping to our SubtitleCue
                    subStore.addCue({
                        id: trackId + '-' + chunk.id,
                        startTime: chunk.start_time,
                        endTime: chunk.end_time,
                        text: chunk.text,
                        originalText: chunk.original_text,
                        words: chunk.words
                    });

                    // Simple progress calculation simulation: 
                    // To do it accurately we'd need total duration. Let queueStore just read total cues found for now.
                    // For UI, we can just say "generating" dynamically.
                    const qStore = useQueueStore.getState();
                    // Just update a ticking progress to let user know it's alive, or mapping to video duration
                    const video = qStore.queues.flatMap(q => q.items).find(v => v.id === videoId);
                    if (video && video.duration > 0) {
                        const prog = Math.min((chunk.end_time / video.duration) * 100, 99.9);
                        qStore.updateVideoSubtitleStatus(videoId, 'generating', parseFloat(prog.toFixed(1)), '正在生成字幕...');
                    }
                } else if (message.type === 'progress') {
                    if (message.message) {
                        useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'generating', undefined, message.message);
                    }
                } else if (message.type === 'transcribe_done') {
                    console.log("Transmission stream finished");
                    useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'done', 100);

                    // Start saving SRT to local disk
                    this.saveSrtToDisk(videoPath, trackId);

                    this.stop(videoId);
                } else if (message.type === 'error') {
                    console.error("Backend gen error:", message.message);
                    useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'error', 0, message.message);
                    this.stop(videoId);
                }
            } catch (e) {
                console.error("Failed parsing message", e);
            }
        };

        ws.onerror = (e) => {
            console.error("WebSocket transport error", e);
            useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'error', 0, '连接后端失败');
        };

        ws.onclose = () => {
            console.log(`Transcribe socket closed for ${videoId}.`);
            this.wsMap.delete(videoId);
        };
    }

    public stop(videoId: string) {
        const ws = this.wsMap.get(videoId);
        if (ws) {
            ws.close();
            this.wsMap.delete(videoId);
        }
    }

    private formatSrtTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    }

    private async saveSrtToDisk(videoPath: string, trackId: string) {
        try {
            const subStore = useSubtitleStore.getState();
            // Filter out the cues for this specific generation pass if multiple exist
            // using the trackId prefix.
            const cues = subStore.cues.filter(c => c.id.toString().startsWith(trackId));
            if (cues.length === 0) return;

            let srtContent = '';
            cues.forEach((cue, index) => {
                srtContent += `${index + 1}\n`;
                srtContent += `${this.formatSrtTime(cue.startTime)} --> ${this.formatSrtTime(cue.endTime)}\n`;
                srtContent += `${cue.text}\n`;
                if (cue.originalText) {
                    srtContent += `${cue.originalText}\n`;
                }
                srtContent += '\n';
            });

            // Make the SRT path based on video path
            // Handle both windows backslashes and unix forward slashes
            const isWin = videoPath.includes('\\');
            const sep = isWin ? '\\' : '/';
            const parts = videoPath.split(sep);
            const filename = parts[parts.length - 1];
            const extIdx = filename.lastIndexOf('.');
            const baseName = extIdx > 0 ? filename.substring(0, extIdx) : filename;

            const modelId = useSettingsStore.getState().selectedModelId;
            const targetLanguage = useSettingsStore.getState().targetLanguage;
            // Examples: MyVideo.zh-AI-large-v3.srt
            const newFilename = `${baseName}.${targetLanguage}-AI-${modelId}.srt`;

            parts[parts.length - 1] = newFilename;
            const srtPath = parts.join(sep);

            await writeTextFile(srtPath, srtContent);
            console.log(`Saved automatically generated subtitle to ${srtPath}`);

            // Update queue store to attach this physical file to the track
            const qStore = useQueueStore.getState();
            qStore.queues.forEach(q => q.items.forEach(v => {
                const tr = v.subtitles?.find(s => s.id === trackId);
                if (tr) {
                    tr.path = srtPath;
                }
            }));

        } catch (err) {
            console.error("Failed to write SRT file to disk automatically.", err);
        }
    }
}

export const subtitleClient = new SubtitleClient();
