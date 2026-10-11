import type { LingxiDocument } from '@lingxi/core';
import { collectCachedSegments } from './collectCachedSegments';
import { safeFilenameStem } from './triggerDownload';

export interface ExportedSrt {
  blob: Blob;
  filename: string;
}

// Only Edge/Aria segments carry real per-word timing (see
// apps/tts-proxy/src/index.ts and CachingTTSEngine.ts — Kokoro's `words` is
// always []), so SRT export requires every cached segment to be Aria, not
// just fully cached. Concatenates each segment's word anchors in order,
// offsetting by where that segment lands in the combined audio timeline
// (its cumulative durationMs so far) — matches the same byte-concatenation
// order exportAudio() uses for an all-Aria document's MP3.
export async function exportSrt(
  doc: LingxiDocument,
  documentText: string,
  voiceURI: string,
  rate: number,
): Promise<ExportedSrt | null> {
  const records = await collectCachedSegments(doc, documentText, voiceURI, rate);
  if (!records || records.some((r) => r.words.length === 0)) return null;

  const cues: string[] = [];
  let runningOffsetMs = 0;
  let cueNumber = 1;

  for (const record of records) {
    for (const word of record.words) {
      const startMs = runningOffsetMs + word.offsetMs;
      const endMs = startMs + word.durationMs;
      cues.push(`${cueNumber}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${word.text}\n`);
      cueNumber++;
    }
    runningOffsetMs += record.durationMs;
  }

  const blob = new Blob([cues.join('\n')], { type: 'application/x-subrip' });
  return { blob, filename: `${safeFilenameStem(doc.title)}.srt` };
}

function formatSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}
