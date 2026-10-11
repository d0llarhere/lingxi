import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LingxiDocument, PlaybackSettings, ReadingCursor } from '../model/types';
import type { DocumentTextRecord, SourceFileRecord } from './records';
import type { SegmentCacheRecord } from './segmentCache';

export const DB_NAME = 'lingxi-db';
export const DB_VERSION = 2;

// One record per document, combining ReadingCursor and PlaybackSettings (see
// ARCHITECTURE.md §9) since both are per-document and voice/speed changes are
// far less frequent writes than cursor updates but share the same lifecycle.
// The settings fields are optional so records created before Phase 3 (which
// only ever wrote a bare ReadingCursor) still read back correctly.
export type CursorRecord = ReadingCursor & Partial<Pick<PlaybackSettings, 'selectedVoiceURI' | 'playbackSpeed'>>;

export interface LingxiDB extends DBSchema {
  documents: { key: string; value: LingxiDocument };
  documentText: { key: string; value: DocumentTextRecord };
  cursors: { key: string; value: CursorRecord };
  sourceFiles: { key: string; value: SourceFileRecord };
  segmentCache: { key: string; value: SegmentCacheRecord };
}

export function openLingxiDB(name: string = DB_NAME): Promise<IDBPDatabase<LingxiDB>> {
  return openDB<LingxiDB>(name, DB_VERSION, {
    // First real migration in this project (DB_VERSION was 1 with no
    // version history until the segmentCache store below) — each block is
    // guarded by oldVersion so upgrading an existing v1 database never
    // re-runs createObjectStore on stores that already exist.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('documents', { keyPath: 'id' });
        db.createObjectStore('documentText', { keyPath: 'documentId' });
        db.createObjectStore('cursors', { keyPath: 'documentId' });
        db.createObjectStore('sourceFiles', { keyPath: 'documentId' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('segmentCache', { keyPath: 'key' });
      }
    },
  });
}
