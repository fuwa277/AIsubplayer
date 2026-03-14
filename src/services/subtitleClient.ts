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

        // 智能推断断点：如果外部没有传入有效的 resumeOffset，但当前 store 中有该轨道的字幕，则自动计算断点续传时间
        let actualResumeOffset = resumeOffset;
        // 放弃严格的 trackId 前缀匹配（因为自动加载时的 trackId 可能不同），只要播放器中目前有显示的字幕就接管续接
        const currentTrackCues = subStore.cues;
        
        console.log(`[前端探针] 发起生成请求: 外部传入 resumeOffset=${resumeOffset}, 当前 store 中字幕条数=${currentTrackCues.length}`);
        
        if (actualResumeOffset === 0 && currentTrackCues.length > 0) {
            actualResumeOffset = currentTrackCues[currentTrackCues.length - 1].endTime + 0.1;
            console.log(`[前端探针] 自动检测到已有字幕，最后一句结束时间=${currentTrackCues[currentTrackCues.length - 1].endTime}，应用断点续传 offset:`, actualResumeOffset);
        } else {
            console.log(`[前端探针] 未触发断点续传计算，最终 actualResumeOffset=${actualResumeOffset}`);
        }

        // Mark starting
        queueStore.updateVideoSubtitleStatus(videoId, 'generating', 0);
        
        // 如果是从头生成才清空；如果是断点续传则保留原有内容在界面上
        if (actualResumeOffset === 0) {
            this.sessionCues.set(videoId, []);
            if (queueStore.getActiveVideo()?.id === videoId) {
                subStore.clearCues(); 
            }
        } else {
            // 将现有的该轨道字幕载入后台缓冲池，避免覆盖丢失
            this.sessionCues.set(videoId, currentTrackCues);
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
                resume_offset: actualResumeOffset, // 将前端算好的断点时间发给后端
                target_srt_path: queueStore.getActiveVideo()?.activeSubtitleId 
                    ? queueStore.getActiveVideo()?.subtitles?.find(s => s.id === queueStore.getActiveVideo()?.activeSubtitleId)?.path || null 
                    : null // 告诉后端直接往当前激活的这个轨道文件里写！
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
            // 发生 error 时不要直接标记为彻底失败，因为紧接着会触发 onclose，让 onclose 去接管自动重连
        };

        ws.onclose = (event) => {
            console.log(`Transcribe socket closed for ${videoId}. Code: ${event.code}`);
            
            // 如果 wsMap 里记录的 websocket 实例还是当前这个，说明不是用户主动点击停止的，而是异常断开
            if (this.wsMap.get(videoId) === ws) {
                this.wsMap.delete(videoId);
                console.warn(`[前端探针] 检测到 WebSocket 异常断开，准备自动重连...`);
                useQueueStore.getState().updateVideoSubtitleStatus(videoId, 'generating', undefined, '连接断开，尝试自动恢复...');
                
                // 延迟 3 秒后重连，防止疯狂重试导致死循环
                setTimeout(() => {
                    // 从缓存池中获取目前已经成功收到的字幕，重新计算最新的断点时间
                    const currentCues = this.sessionCues.get(videoId) || [];
                    const nextOffset = currentCues.length > 0 ? currentCues[currentCues.length - 1].endTime + 0.1 : actualResumeOffset;
                    
                    console.log(`[前端探针] 正在执行自动重连，新的断点时间: ${nextOffset}`);
                    this.generate(videoId, videoPath, trackId, nextOffset);
                }, 3000);
            }
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
