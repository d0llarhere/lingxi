import type { IDBPDatabase } from 'idb';
import type { LingxiDB } from './db';

export interface WordAnchor {
  offsetMs: number;
  durationMs: number;
  text: string;
}

// One cached audio segment, content-addressed by hashText([text, voiceURI,
// String(rate)]) (see cache/hash.ts) rather than by document/sentence
// identity — see ARCHITECTURE.md's segment-cache section for why.
export interface SegmentCacheRecord {
  key: string;
  text: string;
  audioBlob: Blob; // WAV for kokoro (hand-encoded, no real timing), MP3 for edge
  words: WordAnchor[]; // [] for kokoro; real anchors for edge
  engine: 'kokoro' | 'edge';
  durationMs: number;
  createdAt: number;
}

// No eviction/quota management yet — same deferred-and-documented posture as
// ARCHITECTURE.md's "Known dev-tooling vulnerabilities" section. Revisit if
// cache growth becomes a real problem in practice.
export class SegmentCacheRepository {
  constructor(private readonly db: IDBPDatabase<LingxiDB>) {}

  async getSegment(key: string): Promise<SegmentCacheRecord | undefined> {
    return this.db.get('segmentCache', key);
  }

  async putSegment(record: SegmentCacheRecord): Promise<void> {
    await this.db.put('segmentCache', record);
  }

  // Settings→Storage's "Cache" row — sums every segment's blob size. Only
  // called on an occasional Settings-page render, not a hot path, so a
  // plain getAll() + reduce is fine even for a long book's worth of chunks.
  async getTotalSize(): Promise<number> {
    const all = await this.db.getAll('segmentCache');
    return all.reduce((sum, record) => sum + record.audioBlob.size, 0);
  }

  // Wipes the whole store — safe without confirmation (per the brief) since
  // this is purely a regenerable synthesis cache, never user-authored data.
  async clear(): Promise<void> {
    await this.db.clear('segmentCache');
  }
}
