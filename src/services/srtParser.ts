import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { SubtitleCue } from '../stores/subtitleStore';

export function formatSrtTimeStr(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export async function writeSrt(path: string, cues: SubtitleCue[]) {
    let srtContent = '';
    cues.forEach((cue, index) => {
        srtContent += `${index + 1}\n`;
        srtContent += `${formatSrtTimeStr(cue.startTime)} --> ${formatSrtTimeStr(cue.endTime)}\n`;
        srtContent += `${cue.text}\n`;
        if (cue.originalText) {
            srtContent += `${cue.originalText}\n`;
        }
        srtContent += '\n';
    });
    await writeTextFile(path, srtContent);
}

export async function parseSrt(path: string, trackId?: string): Promise<SubtitleCue[]> {
    const content = await readTextFile(path);
    // basic SRT parser
    const blocks = content.replace(/\r\n/g, '\n').split('\n\n').filter(Boolean);
    const cues: SubtitleCue[] = [];

    const timeRegex = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

    const parseTime = (h: string, m: string, s: string, ms: string) => {
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
    };

    blocks.forEach((block, idx) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 3) {
            const timeMatches = lines[1].match(timeRegex);
            if (timeMatches) {
                const startTime = parseTime(timeMatches[1], timeMatches[2], timeMatches[3], timeMatches[4]);
                const endTime = parseTime(timeMatches[5], timeMatches[6], timeMatches[7], timeMatches[8]);

                const textLines = lines.slice(2);
                let text = textLines[0] || '';
                let originalText = textLines[1] || undefined;

                // If it's a multiline single sub rather than bilingual, join them just in case
                if (textLines.length > 2) {
                    text = textLines.join(' ');
                    originalText = undefined;
                }

                cues.push({
                    id: trackId ? `${trackId}-${idx}` : 'ext-' + idx + '-' + Date.now().toString().slice(-4),
                    startTime,
                    endTime,
                    text: text,
                    originalText
                });
            }
        }
    });
    
    // 第一道防线：静默自愈（容错解析）
    // 过滤掉因为断电或中途强杀进程导致的只有 startTime 但没有有效 endTime (或时间错乱) 的残缺块
    const validCues = cues.filter(c => c.endTime > c.startTime);

    return validCues;
}

export const readSrt = async (path: string): Promise<any[]> => {
    try {
        const content = await readTextFile(path);
        // 统一换行符并根据空行分割每个字幕块
        const blocks = content.replace(/\r\n/g, '\n').trim().split('\n\n');
        
        return blocks.map(block => {
            const lines = block.split('\n');
            const id = lines[0];
            const timeStr = lines[1] || '';
            const textLines = lines.slice(2);
            
            const [startStr, endStr] = timeStr.split(' --> ');
            
            // 将 SRT 的时间戳 (00:00:00,000) 转换为秒数
            const parseTime = (str: string) => {
                if (!str) return 0;
                const parts = str.split(':');
                if (parts.length !== 3) return 0;
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                const sParts = parts[2].split(',');
                const s = parseInt(sParts[0], 10);
                const ms = parseInt(sParts[1] || '0', 10);
                return h * 3600 + m * 60 + s + ms / 1000;
            };
            
            return {
                id,
                startTime: parseTime(startStr),
                endTime: parseTime(endStr),
                text: textLines[0] || '',
                originalText: textLines.length > 1 ? textLines.slice(1).join('\n') : undefined
            };
        });
    } catch (error) {
        console.error("读取 SRT 文件失败:", error);
        throw error;
    }
};