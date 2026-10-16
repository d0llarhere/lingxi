import { DownloadJobRepository, openLingxiDB } from '@lingxi/core';

// Same pattern as segmentCacheInstance.ts — its own connection to the shared
// lingxi-db database, for the download queue singleton outside React.
let ready: Promise<DownloadJobRepository> | null = null;

export function getDownloadJobRepository(): Promise<DownloadJobRepository> {
  if (!ready) {
    ready = openLingxiDB().then((db) => new DownloadJobRepository(db));
  }
  return ready;
}
