import {
  buildChunkSequence,
  detectChapters,
  subtractChunkRanges,
  type AudioItemRecord,
  type ChunkIndexRange,
  type DownloadJobRecord,
  type LingxiDocument,
} from '@lingxi/core';
import { collectCachedSegments } from '../export/collectCachedSegments';
import { exportAudio } from '../export/exportAudio';
import { exportSrt } from '../export/exportSrt';
import { getAudioLibraryRepository } from '../library/audioLibraryInstance';
import { getLibraryRepository } from '../library/libraryRepositoryInstance';
import { readChapterDetectionSettings } from '../settings/useChapterDetection';
import { getDownloadJobRepository } from './downloadJobInstance';
import { cachingEngine } from './ttsEngineInstance';

export type DownloadJobSnapshot = {
  status: DownloadJobRecord['status'];
  fromChunkIndex: number;
  toChunkIndex: number;
  progress: number; // 0..1, within this job's own requested range
  etaSeconds: number | null;
  error: string | null;
};

type SnapshotListener = (snapshot: DownloadJobSnapshot | null) => void;

// Replaces the old whole-book-only, in-memory-only downloader with a
// persisted, resumable, one-job-at-a-time FIFO queue — see
// docs/lingxi-part4/BRIEF_DOWNLOAD_RANGES.md. No fine-grained per-chunk
// progress is persisted: on resume (a fresh page load, or Resume after a
// pause) the job's whole [fromChunkIndex, toChunkIndex] range is walked
// again through cachingEngine.ensureCached() — already-cached chunks are a
// cheap cache-hit read, not re-synthesis, so this is correct and fast
// without needing to track exactly which chunk a run stopped at.
//
// Per-documentId status (not a single global snapshot like before) since
// jobs for different books can be queued at once, even though only one
// actually runs at a time.
export class DownloadQueue {
  private queue: DownloadJobRecord[] = [];
  private activeJob: DownloadJobRecord | null = null;
  private activeGeneration = 0;
  private pauseOrCancelIntent: 'pause' | 'cancel' | null = null;
  private listeners = new Map<string, Set<SnapshotListener>>();
  private snapshots = new Map<string, DownloadJobSnapshot>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.loadPersistedJobs();
  }

  private async loadPersistedJobs(): Promise<void> {
    const repo = await getDownloadJobRepository();
    const jobs = await repo.listJobs();
    for (const job of jobs) {
      // Nothing is actually running right after a fresh page load — a
      // job that was 'downloading' when the page closed just means it was
      // interrupted mid-run; treat it the same as 'queued' so the FIFO loop
      // picks it back up.
      const resumable: DownloadJobRecord = job.status === 'downloading' ? { ...job, status: 'queued' } : job;
      if (resumable.status === 'queued') this.queue.push(resumable);
      this.publishSnapshot(resumable.documentId, this.snapshotFor(resumable));
    }
    void this.processNext();
  }

  getJobSnapshot(documentId: string): DownloadJobSnapshot | null {
    return this.snapshots.get(documentId) ?? null;
  }

  subscribe(documentId: string, listener: SnapshotListener): () => void {
    let set = this.listeners.get(documentId);
    if (!set) {
      set = new Set();
      this.listeners.set(documentId, set);
    }
    set.add(listener);
    listener(this.getJobSnapshot(documentId));
    return () => set!.delete(listener);
  }

  async enqueue(doc: LingxiDocument, voiceURI: string, rate: number, range: ChunkIndexRange): Promise<void> {
    await this.ready;
    const job: DownloadJobRecord = {
      id: crypto.randomUUID(),
      documentId: doc.id,
      title: doc.title,
      voiceURI,
      rate,
      fromChunkIndex: range.fromChunkIndex,
      toChunkIndex: range.toChunkIndex,
      status: 'queued',
      error: null,
      createdAt: Date.now(),
    };
    const repo = await getDownloadJobRepository();
    await repo.saveJob(job);
    this.queue.push(job);
    this.publishSnapshot(job.documentId, this.snapshotFor(job));
    void this.processNext();
  }

  async pause(documentId: string): Promise<void> {
    await this.ready;
    await this.stopOrRemove(documentId, 'pause');
  }

  async cancel(documentId: string): Promise<void> {
    await this.ready;
    await this.stopOrRemove(documentId, 'cancel');
  }

  // A paused *or* errored job can be picked back up the same way.
  async resume(documentId: string): Promise<void> {
    await this.ready;
    const repo = await getDownloadJobRepository();
    const stored = (await repo.listJobs()).find((j) => j.documentId === documentId && (j.status === 'paused' || j.status === 'error'));
    if (!stored) return;
    const resumed: DownloadJobRecord = { ...stored, status: 'queued', error: null };
    await repo.saveJob(resumed);
    this.queue.push(resumed);
    this.publishSnapshot(documentId, this.snapshotFor(resumed));
    void this.processNext();
  }

  private async stopOrRemove(documentId: string, intent: 'pause' | 'cancel'): Promise<void> {
    if (this.activeJob?.documentId === documentId) {
      // Interrupts the running loop; it persists/deletes the job itself
      // once it notices the generation changed (see processJob).
      this.pauseOrCancelIntent = intent;
      this.activeGeneration++;
      return;
    }

    const repo = await getDownloadJobRepository();
    const queueIndex = this.queue.findIndex((j) => j.documentId === documentId);
    const queued = queueIndex !== -1 ? this.queue.splice(queueIndex, 1)[0]! : null;
    const stored = queued ?? (await repo.listJobs()).find((j) => j.documentId === documentId);
    if (!stored) return;

    if (intent === 'cancel') {
      await repo.deleteJob(stored.id);
      this.publishSnapshot(documentId, null);
    } else {
      const paused: DownloadJobRecord = { ...stored, status: 'paused' };
      await repo.saveJob(paused);
      this.publishSnapshot(documentId, this.snapshotFor(paused));
    }
  }

  private async processNext(): Promise<void> {
    if (this.activeJob) return; // one job at a time
    const job = this.queue.shift();
    if (!job) return;
    await this.processJob(job);
  }

  private async processJob(job: DownloadJobRecord): Promise<void> {
    const generation = ++this.activeGeneration;
    this.pauseOrCancelIntent = null;
    this.activeJob = job;

    const jobRepo = await getDownloadJobRepository();
    await jobRepo.saveJob({ ...job, status: 'downloading' });
    this.publishSnapshot(job.documentId, this.snapshotFor({ ...job, status: 'downloading' }));

    const libraryRepo = await getLibraryRepository();
    const [doc, documentText] = await Promise.all([libraryRepo.getDocument(job.documentId), libraryRepo.getDocumentText(job.documentId)]);
    if (!doc || !documentText) {
      // The book was deleted since this job was queued — nothing left to download.
      await jobRepo.deleteJob(job.id);
      this.publishSnapshot(job.documentId, null);
      this.activeJob = null;
      void this.processNext();
      return;
    }

    const chunks = buildChunkSequence(doc.structure, documentText);
    const audioRepo = await getAudioLibraryRepository();
    const recordId = `book-${doc.id}-${job.voiceURI}-${job.rate}`;
    const existingBefore = await audioRepo.getAudioItem(recordId);
    const alreadyCovered = existingBefore?.chunkRanges ?? [];

    let addedSizeBytes = 0;
    let addedDurationMs = 0;
    let lastCompletedIndex = job.fromChunkIndex - 1;
    let runError: string | null = null;
    const startedAt = Date.now();
    const total = job.toChunkIndex - job.fromChunkIndex + 1;

    for (let i = job.fromChunkIndex; i <= job.toChunkIndex && i < chunks.length; i++) {
      if (this.activeGeneration !== generation) break;
      const chunk = chunks[i]!;
      try {
        // Sequential, not parallel — see the old OfflineDownloader's own
        // reasoning (naturally paces requests, doesn't flood Kokoro's
        // single-worker queue).
        const segment = await cachingEngine.ensureCached(chunk.text, job.voiceURI, job.rate);
        lastCompletedIndex = i;
        if (subtractChunkRanges({ fromChunkIndex: i, toChunkIndex: i }, alreadyCovered).length > 0) {
          addedSizeBytes += segment.audioBlob.size;
          addedDurationMs += segment.durationMs;
        }
      } catch (error) {
        runError = error instanceof Error ? error.message : 'Download failed.';
        break;
      }
      if (this.activeGeneration !== generation) break;
      const completed = i - job.fromChunkIndex + 1;
      const avgMsPerChunk = (Date.now() - startedAt) / completed;
      const remaining = total - completed;
      const etaSeconds = remaining > 0 ? (avgMsPerChunk * remaining) / 1000 : null;
      this.publishSnapshot(job.documentId, this.snapshotFor({ ...job, status: 'downloading' }, completed / total, etaSeconds));
    }

    // Persist whatever was actually completed this run, regardless of how
    // the loop ended — already-cached chunks are never lost, so partial
    // progress (a pause, a cancel, or an error partway through) should
    // never be silently dropped from the book's saved-ranges display.
    if (lastCompletedIndex >= job.fromChunkIndex) {
      const updated = await audioRepo.mergeDownloadedRange({
        id: recordId,
        documentId: doc.id,
        title: doc.title,
        voiceURI: job.voiceURI,
        rate: job.rate,
        range: { fromChunkIndex: job.fromChunkIndex, toChunkIndex: lastCompletedIndex },
        addedSizeBytes,
        addedDurationMs,
      });
      await this.maybeFinalizeFullBook(doc, documentText, chunks.length, updated, job.voiceURI, job.rate);
    }

    const interrupted = this.activeGeneration !== generation;
    if (interrupted && this.pauseOrCancelIntent === 'cancel') {
      await jobRepo.deleteJob(job.id);
      this.publishSnapshot(job.documentId, null);
    } else if (interrupted && this.pauseOrCancelIntent === 'pause') {
      const paused: DownloadJobRecord = { ...job, status: 'paused' };
      await jobRepo.saveJob(paused);
      this.publishSnapshot(job.documentId, this.snapshotFor(paused));
    } else if (!interrupted && runError) {
      const errored: DownloadJobRecord = { ...job, status: 'error', error: runError };
      await jobRepo.saveJob(errored);
      this.publishSnapshot(job.documentId, this.snapshotFor(errored));
    } else if (!interrupted) {
      await jobRepo.deleteJob(job.id);
      this.publishSnapshot(job.documentId, null);
    }

    this.activeJob = null;
    void this.processNext();
  }

  // Once a book's coverage reaches the whole document, it qualifies for
  // exactly the same "fully cached" export the reader's pill menu already
  // offers — reused as-is (exportAudio/exportSrt/collectCachedSegments,
  // unchanged) to materialize the single playable blob, same as the old
  // whole-book-only downloader always did. A failure here is logged, not
  // surfaced as a download error — the per-chunk cache (and thus offline
  // reader playback) is already correct and complete either way; only the
  // Downloads page's "play like a podcast file" ability is affected.
  private async maybeFinalizeFullBook(
    doc: LingxiDocument,
    documentText: string,
    totalChunks: number,
    record: AudioItemRecord,
    voiceURI: string,
    rate: number,
  ): Promise<void> {
    if (record.audioReady || totalChunks === 0) return;
    const coversWholeBook = record.chunkRanges.length === 1 && record.chunkRanges[0]!.fromChunkIndex === 0 && record.chunkRanges[0]!.toChunkIndex === totalChunks - 1;
    if (!coversWholeBook) return;

    try {
      const [audio, srt, records] = await Promise.all([
        exportAudio(doc, documentText, voiceURI, rate),
        exportSrt(doc, documentText, voiceURI, rate),
        collectCachedSegments(doc, documentText, voiceURI, rate),
      ]);
      if (!audio || !records) return;

      const chapters = detectChapters(documentText, readChapterDetectionSettings());
      const chapterLabel = chapters.length > 0 ? `Ch. 1–${chapters.length}` : 'Whole book';
      const durationMs = records.reduce((sum, r) => sum + r.durationMs, 0);
      const subtitleText = srt ? await srt.blob.text() : null;

      const audioRepo = await getAudioLibraryRepository();
      await audioRepo.saveAudioItem({
        ...record,
        sizeBytes: audio.blob.size,
        durationMs,
        audioBlob: audio.blob,
        mimeType: audio.blob.type,
        subtitlesOn: subtitleText !== null,
        subtitleFilename: subtitleText ? `${doc.title}.srt` : null,
        subtitleText,
        chapterLabel,
        audioReady: true,
      });
    } catch (error) {
      console.error('Failed to finalize fully-downloaded book audio', error);
    }
  }

  private publishSnapshot(documentId: string, snapshot: DownloadJobSnapshot | null): void {
    if (snapshot) this.snapshots.set(documentId, snapshot);
    else this.snapshots.delete(documentId);
    const set = this.listeners.get(documentId);
    if (set) for (const listener of set) listener(snapshot);
  }

  private snapshotFor(job: DownloadJobRecord, progress = 0, etaSeconds: number | null = null): DownloadJobSnapshot {
    return {
      status: job.status,
      fromChunkIndex: job.fromChunkIndex,
      toChunkIndex: job.toChunkIndex,
      progress,
      etaSeconds,
      error: job.error,
    };
  }
}

export const offlineDownloader = new DownloadQueue();
