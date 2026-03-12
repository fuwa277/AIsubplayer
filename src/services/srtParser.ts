import { readTextFile } from '@tauri-apps/plugin-fs';
import { SubtitleCue } from '../stores/subtitleStore';

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

    return cues;
}
