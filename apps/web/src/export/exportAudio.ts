import type { LingxiDocument } from '@lingxi/core';
import { encodeWav } from '../tts/wavEncoder';
import { collectCachedSegments } from './collectCachedSegments';
import { safeFilenameStem } from './triggerDownload';

export interface ExportedAudio {
  blob: Blob;
  filename: string;
}

// Requires every segment already cached (see collectCachedSegments) — no
// on-the-fly synthesis here, by design: export is meant to be instant once
// "Download for offline" (or just finishing a read-through) has populated
// the cache, never a second multi-second wait of its own.
export async function exportAudio(
  doc: LingxiDocument,
  documentText: string,
  voiceURI: string,
  rate: number,
): Promise<ExportedAudio | null> {
  const records = await collectCachedSegments(doc, documentText, voiceURI, rate);
  if (!records) return null;

  const stem = safeFilenameStem(doc.title);
  const allAria = records.every((r) => r.engine === 'edge');

  if (allAria) {
    // Edge's MP3 segments are plain CBR MPEG frames (confirmed via ffprobe
    // during development) — concatenating the raw bytes produces one valid
    // playable file with no decode/re-encode needed.
    const blob = new Blob(
      records.map((r) => r.audioBlob) as BlobPart[],
      { type: 'audio/mpeg' },
    );
    return { blob, filename: `${stem}.mp3` };
  }

  // Kokoro (WAV) and mixed-engine documents: decodeAudioData handles both
  // WAV and MP3 uniformly, so this is the one path that works regardless of
  // which engine(s) produced which segment — decode everything back to raw
  // PCM on one shared AudioContext (guaranteeing a consistent output sample
  // rate across every segment) and re-encode as a single WAV.
  const ctx = new AudioContext();
  try {
    const buffers = await Promise.all(
      records.map(async (r) => ctx.decodeAudioData(await r.audioBlob.arrayBuffer())),
    );
    const sampleRate = buffers[0]!.sampleRate;
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      combined.set(buffer.getChannelData(0), offset);
      offset += buffer.length;
    }
    return { blob: encodeWav(combined, sampleRate), filename: `${stem}.wav` };
  } finally {
    void ctx.close();
  }
}
