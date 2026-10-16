import { LibraryRepository, openLingxiDB } from '@lingxi/core';

// Same reasoning as segmentCacheInstance.ts/audioLibraryInstance.ts: a
// non-hook accessor for module-level singletons that live outside the React
// tree (the download queue, resuming persisted jobs on startup) — the
// LibraryProvider's own `repository` is React-context-only and unreachable
// from there.
let ready: Promise<LibraryRepository> | null = null;

export function getLibraryRepository(): Promise<LibraryRepository> {
  if (!ready) {
    ready = openLingxiDB().then((db) => new LibraryRepository(db));
  }
  return ready;
}
