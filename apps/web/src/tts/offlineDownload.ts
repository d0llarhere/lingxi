import { buildChunkSequence, type LingxiDocument } from '@lingxi/core';
import { cachingEngine } from './ttsEngineInstance';

export type OfflineDownloadStatus = 'not-started' | 'downloading' | 'ready' | 'error';

export interface OfflineDownloadSnapshot {
  status: OfflineDownloadStatus;
  progress: number; // 0..1
  error: string | null;
}

type StatusListener = (snapshot: OfflineDownloadSnapshot) => void;

// Walks a document's chunks (the same multi-sentence grouping live playback
// uses — see chunking.ts) and populates the segment cache for a given
// voice/rate without playing anything, for later fully-offline playback (and
// as the thing that makes export's "fully cached" gate achievable without
// first reading the whole document start to finish). Chunk granularity
// matters: it's what keeps this sharing cache entries with ordinary playback
// instead of silently re-synthesizing everything the document may have
// already had played naturally. Same status/subscribe shape as
// KokoroTTSEngine's model-download tracking — PlaybackControls.tsx reuses
// the exact same local-voice-status JSX/CSS for both.
export class OfflineDownloader {
  private status: OfflineDownloadStatus = 'not-started';
  private progress = 0;
  private error: string | null = null;
  private listeners = new Set<StatusListener>();
  // Bumped on every download() call so a stale run's in-flight loop stops
  // updating status once a newer run (or a different document) supersedes it.
  private activeRun = 0;

  getStatusSnapshot(): OfflineDownloadSnapshot {
    return { status: this.status, progress: this.progress, error: this.error };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatusSnapshot());
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: OfflineDownloadStatus, progress: number, error: string | null = null): void {
    this.status = status;
    this.progress = progress;
    this.error = error;
    for (const listener of this.listeners) listener(this.getStatusSnapshot());
  }

  async download(doc: LingxiDocument, documentText: string, voiceURI: string, rate: number): Promise<void> {
    const runId = ++this.activeRun;
    const chunks = buildChunkSequence(doc.structure, documentText);
    this.setStatus('downloading', 0);

    for (let i = 0; i < chunks.length; i++) {
      if (runId !== this.activeRun) return; // superseded by a newer download() call
      try {
        // Sequential, not parallel: naturally paces requests well under the
        // proxy's rate limit (real synthesis latency per chunk already
        // dominates — each chunk is ~900 chars, not one short sentence, so
        // there are far fewer requests total than the old per-sentence
        // design needed), and keeps Kokoro's single-worker generation queue
        // from being flooded.
        await cachingEngine.ensureCached(chunks[i]!.text, voiceURI, rate);
      } catch (error) {
        if (runId !== this.activeRun) return;
        this.setStatus('error', i / chunks.length, error instanceof Error ? error.message : 'Download failed.');
        return;
      }
      this.setStatus('downloading', (i + 1) / chunks.length);
    }

    if (runId !== this.activeRun) return;
    this.setStatus('ready', 1);
  }
}

export const offlineDownloader = new OfflineDownloader();
