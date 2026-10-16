import type { IDBPDatabase } from 'idb';
import type { LingxiDB } from './db';

// One row per in-flight/queued/paused range download — what makes the
// download queue (apps/web/src/tts/offlineDownload.ts) resumable across a
// reload (see docs/lingxi-part4/BRIEF_DOWNLOAD_RANGES.md). No fine-grained
// per-chunk progress is persisted here: on resume the queue just re-walks
// ensureCached() over [fromChunkIndex, toChunkIndex] again — already-cached
// chunks are a cheap cache hit, not re-synthesis, so this is correct and
// fast without needing to track exactly which chunk it stopped at. A job is
// deleted outright once it completes or is cancelled, so "every row in this
// store" is always exactly "every active/queued/paused job".
export interface DownloadJobRecord {
  id: string;
  documentId: string;
  title: string;
  voiceURI: string;
  rate: number;
  fromChunkIndex: number;
  toChunkIndex: number;
  status: 'queued' | 'downloading' | 'paused' | 'error';
  error: string | null;
  createdAt: number;
}

export class DownloadJobRepository {
  constructor(private readonly db: IDBPDatabase<LingxiDB>) {}

  async listJobs(): Promise<DownloadJobRecord[]> {
    return this.db.getAll('downloadJobs');
  }

  async saveJob(job: DownloadJobRecord): Promise<void> {
    await this.db.put('downloadJobs', job);
  }

  async deleteJob(id: string): Promise<void> {
    await this.db.delete('downloadJobs', id);
  }
}
