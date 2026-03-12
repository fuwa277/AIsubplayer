import { useSubtitleStore } from '../stores/subtitleStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';

class SubtitleClient {
    private wsMap = new Map<string, WebSocket>();
    private sessionCues = new Map<string, import('../stores/subtitleStore').SubtitleCue[]>();

    public async generate(videoId: string, videoPath: string, trackId: string, resumeOffset: number = 0) {
        // Disconnect previous for this specific video if exists
        this.stop(videoId);

        const settings = useSettingsStore.getState();
        const queueStore = useQueueStore.getState();
        const subStore = useSubtitleStore.getState();

        // Mark starting
        queueStore.updateVideoSubtitleStatus(videoId, 'generating', 0);
        
        // 如果是从头生成才清空；如果是断点续传则保留原有内容在界面上
        if (resumeOffset === 0) {
            this.sessionCues.set(videoId, []);
            if (queueStore.getActiveVideo()?.id === videoId) {
                subStore.clearCues(); 
            }
        } else {
            // 将现有的该轨道字幕载入后台缓冲池，避免覆盖丢失
            const currentCues = subStore.cues.filter(c => c.id.toString().startsWith(trackId));
            this.sessionCues.set(videoId, currentCues);
        }

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
                remove_punctuation: false, // TBD expose setting if requested
                resume_offset: resumeOffset // 将前端算好的断点时间发给后端
            };
            ws.send(JSON.stringify(config));
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'subtitle_chunk') {
                    const chunk = message.data;
                    // chunk matched the Pydantic schema SubtitleSegment
                    const newCue = {
                        id: trackId + '-' + chunk.id,
                        startTime: chunk.start_time,
                        endTime: chunk.end_time,
                        text: chunk.text,
                        originalText: chunk.original_text,
                        words: chunk.words
                    };

                    // 保存到后台隔离缓冲池
                    const cues = this.sessionCues.get(videoId) || [];
                    cues.push(newCue);
                    this.sessionCues.set(videoId, cues);

                    const qStore = useQueueStore.getState();

                    // 只有当当前正在播放的视频是该生成任务的视频时，才同步更新前端UI
                    if (qStore.getActiveVideo()?.id === videoId) {
                        subStore.addCue(newCue);
                    }

                    // Simple progress calculation simulation: 
                    const video = qStore.queues.flatMap(q => q.items).find(v => v.id === videoId);
                    if (video && video.duration > 0) {
                        const prog = Math.min((chunk.end_time / video.duration) * 100, 99.9);
                        qStore.updateVideoSubtitleStatus(videoId, 'generating', parseFloat(prog.toFixed(1)), '正在生成字幕...');
                    }
                    
                    // 后端会实时写入字幕文件，前端只需更新状态
                } else if (message.type === 'progress') {
                    if (message.message) {
                        useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'generating', undefined, message.message);
                    }
                } else if (message.type === 'transcribe_done') {
                    console.log("Transmission stream finished");
                    useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'done', 100);

                    // 后端已完成字幕文件的最终写入

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

    public getSessionCues(videoId: string) {
        return this.sessionCues.get(videoId) || [];
    }

    public stop(videoId: string) {
        const ws = this.wsMap.get(videoId);
        if (ws) {
            ws.close();
            this.wsMap.delete(videoId);
        }
    }

    }

export const subtitleClient = new SubtitleClient();
