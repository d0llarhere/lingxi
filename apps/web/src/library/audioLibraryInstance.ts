import { AudioLibraryRepository, openLingxiDB } from '@lingxi/core';

// Its own IndexedDB connection to the same lingxi-db database — same
// pattern as segmentCacheInstance.ts, needed because this is consumed both
// by React components (Downloads/Settings screens) and by module-level
// singletons outside the React tree (offlineDownload.ts).
let ready: Promise<AudioLibraryRepository> | null = null;

export function getAudioLibraryRepository(): Promise<AudioLibraryRepository> {
  if (!ready) {
    ready = openLingxiDB().then((db) => new AudioLibraryRepository(db));
  }
  return ready;
}
