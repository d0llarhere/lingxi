import { openLingxiDB, SegmentCacheRepository } from '@lingxi/core';

// Its own IndexedDB connection to the same lingxi-db database LibraryProvider
// connects to (IndexedDB supports multiple independent connections to one
// database natively) — needed because this is consumed by module-level TTS
// engine singletons (CachingTTSEngine, offlineDownload.ts) that live outside
// the React tree, the same way kokoroEngine/edgeEngine already do.
let ready: Promise<SegmentCacheRepository> | null = null;

export function getSegmentCacheRepository(): Promise<SegmentCacheRepository> {
  if (!ready) {
    ready = openLingxiDB().then((db) => new SegmentCacheRepository(db));
  }
  return ready;
}
