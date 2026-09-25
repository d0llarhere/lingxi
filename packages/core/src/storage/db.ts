import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LingxiDocument, ReadingCursor } from '../model/types';
import type { DocumentTextRecord, SourceFileRecord } from './records';

export const DB_NAME = 'lingxi-db';
export const DB_VERSION = 1;

export interface LingxiDB extends DBSchema {
  documents: { key: string; value: LingxiDocument };
  documentText: { key: string; value: DocumentTextRecord };
  cursors: { key: string; value: ReadingCursor };
  sourceFiles: { key: string; value: SourceFileRecord };
}

export function openLingxiDB(name: string = DB_NAME): Promise<IDBPDatabase<LingxiDB>> {
  return openDB<LingxiDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'id' });
      db.createObjectStore('documentText', { keyPath: 'documentId' });
      db.createObjectStore('cursors', { keyPath: 'documentId' });
      db.createObjectStore('sourceFiles', { keyPath: 'documentId' });
    },
  });
}
