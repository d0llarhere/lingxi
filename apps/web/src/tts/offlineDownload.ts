import { buildChunkSequence, detectChapters, type LingxiDocument } from '@lingxi/core';
import { collectCachedSegments } from '../export/collectCachedSegments';
import { exportAudio } from '../export/exportAudio';
import { exportSrt } from '../export/exportSrt';
import { getAudioLibraryRepository } from '../library/audioLibraryInstance';
import { readChapterDetectionSettings } from '../settings/useChapterDetection';
import { cachingEngine } from './ttsEngineInstance';

export type OfflineDownloadStatus = 'not-started' | 'downloading' | 'ready' | 'error';

export interface OfflineDownloadSnapshot {
  status: OfflineDownloadStatus;
  progress: number; // 0..1
  error: string | null;
  // Estimated seconds remaining, extrapolated from the average time per
  // chunk actually observed so far this run — not a guess made up front.
  // null until at least one chunk has completed (one data point isn't a
  // trustworthy rate yet) or when not downloading.
  etaSeconds: number | null;
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
  private etaSeconds: number | null = null;
  private listeners = new Set<StatusListener>();
  // Bumped on every download() call so a stale run's in-flight loop stops
  // updating status once a newer run (or a different document) supersedes it.
  private activeRun = 0;

  getStatusSnapshot(): OfflineDownloadSnapshot {
    return { status: this.status, progress: this.progress, error: this.error, etaSeconds: this.etaSeconds };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatusSnapshot());
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: OfflineDownloadStatus, progress: number, etaSeconds: number | null, error: string | null = null): void {
    this.status = status;
    this.progress = progress;
    this.etaSeconds = etaSeconds;
    this.error = error;
    for (const listener of this.listeners) listener(this.getStatusSnapshot());
  }

  async download(doc: LingxiDocument, documentText: string, voiceURI: string, rate: number): Promise<void> {
    const runId = ++this.activeRun;
    const chunks = buildChunkSequence(doc.structure, documentText);
    const startedAt = Date.now();
    this.setStatus('downloading', 0, null);

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
        this.setStatus('error', i / chunks.length, null, error instanceof Error ? error.message : 'Download failed.');
        return;
      }
      const completed = i + 1;
      // Extrapolated from this run's own observed average, not a canned
      // per-chunk guess — synthesis latency differs wildly between a local
      // Kokoro WASM worker and a network round-trip through the Aria proxy,
      // so only a live measurement is trustworthy.
      const avgMsPerChunk = (Date.now() - startedAt) / completed;
      const remaining = chunks.length - completed;
      const eta = remaining > 0 ? (avgMsPerChunk * remaining) / 1000 : null;
      this.setStatus('downloading', completed / chunks.length, eta);
    }

    if (runId !== this.activeRun) return;
    await this.persistAudioItem(doc, documentText, voiceURI, rate);
    if (runId !== this.activeRun) return;
    this.setStatus('ready', 1, null);
  }

  // Once every chunk is cached, the book qualifies for exactly the same
  // "fully cached" export the reader's pill menu already offers — reused
  // as-is here to build the Downloads page's 'book' audio item, rather
  // than re-deriving a concatenated blob a second way. A failure here
  // (e.g. exportAudio somehow finding a gap) is logged, not surfaced as a
  // download error — the offline-playback cache itself is still correct
  // and complete either way; only the Downloads-page listing is affected.
  private async persistAudioItem(doc: LingxiDocument, documentText: string, voiceURI: string, rate: number): Promise<void> {
    try {
      const [audio, srt, records] = await Promise.all([
        exportAudio(doc, documentText, voiceURI, rate),
        exportSrt(doc, documentText, voiceURI, rate),
        collectCachedSegments(doc, documentText, voiceURI, rate),
      ]);
      if (!audio || !records) return;

      const chapters = detectChapters(documentText, readChapterDetectionSettings());
      const chapterLabel = chapters.length > 0 ? `Ch. 1–${chapters.length}` : 'Whole book';
      const durationMs = records.reduce((sum, record) => sum + record.durationMs, 0);
      const subtitleText = srt ? await srt.blob.text() : null;

      const repo = await getAudioLibraryRepository();
      await repo.saveAudioItem({
        // Deterministic so re-downloading the same book/voice/rate updates
        // the existing item in place instead of duplicating it.
        id: `book-${doc.id}-${voiceURI}-${rate}`,
        kind: 'book',
        title: doc.title,
        createdAt: Date.now(),
        lastPlayedAt: null,
        sizeBytes: audio.blob.size,
        durationMs,
        audioBlob: audio.blob,
        mimeType: audio.blob.type,
        positionMs: 0,
        rate,
        subtitlesOn: subtitleText !== null,
        subtitleFilename: subtitleText ? `${doc.title}.srt` : null,
        subtitleText,
        documentId: doc.id,
        voiceURI,
        chapterLabel,
      });
    } catch (error) {
      console.error('Failed to save downloaded audio item', error);
    }
  }
}

export const offlineDownloader = new OfflineDownloader();
