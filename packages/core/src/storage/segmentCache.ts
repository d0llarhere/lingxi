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
}
