import { buildChunkSequence, hashText, type LingxiDocument, type SegmentCacheRecord } from '@lingxi/core';
import { getSegmentCacheRepository } from '../tts/segmentCacheInstance';

// Shared by the export pipeline and the "is this document ready to export"
// UI check — same cache key derivation CachingTTSEngine uses (content hash
// of text+voiceURI+rate, no document/segment identity — see
// CachingTTSEngine.ts) over the same chunk boundaries live playback uses
// (buildChunkSequence — see chunking.ts and PlaybackController's chunking
// note). Chunk granularity matters here, not just sentence granularity: a
// document read straight through normally populates the cache one
// multi-sentence chunk at a time, not one sentence at a time, so looking
// this up per-sentence would never find those entries and would force a
// full from-scratch re-synthesis on every export/offline-download attempt.
// Returns null if any chunk is missing from the cache, rather than a partial
// list — callers should gate export entirely on "fully cached".
export async function collectCachedSegments(
  doc: LingxiDocument,
  documentText: string,
  voiceURI: string,
  rate: number,
): Promise<SegmentCacheRecord[] | null> {
  const repo = await getSegmentCacheRepository();
  const chunks = buildChunkSequence(doc.structure, documentText);
  if (chunks.length === 0) return null;

  const records: SegmentCacheRecord[] = [];
  for (const chunk of chunks) {
    const key = await hashText([chunk.text, voiceURI, String(rate)]);
    const record = await repo.getSegment(key);
    if (!record) return null;
    records.push(record);
  }
  return records;
}
