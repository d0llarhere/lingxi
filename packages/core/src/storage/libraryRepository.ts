import type { IDBPDatabase } from 'idb';
import type { LingxiDocument, ReadingCursor } from '../model/types';
import { segmentText } from '../segmentation/segmentText';
import type { LingxiDB } from './db';

function initialCursor(documentId: string): ReadingCursor {
  return {
    documentId,
    wordIndex: 0,
    charOffset: 0,
    pageIndex: 0,
    paragraphIndex: 0,
    sentenceIndex: 0,
    updatedAt: Date.now(),
  };
}

export class LibraryRepository {
  constructor(private readonly db: IDBPDatabase<LingxiDB>) {}

  async createFromPastedText(title: string, text: string): Promise<LingxiDocument> {
    const now = Date.now();
    const doc: LingxiDocument = {
      id: crypto.randomUUID(),
      title,
      sourceType: 'pasted-text',
      createdAt: now,
      lastOpenedAt: now,
      extractionStatus: 'ok',
      structure: segmentText(text),
    };

    const tx = this.db.transaction(['documents', 'documentText', 'cursors'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').put(doc),
      tx.objectStore('documentText').put({ documentId: doc.id, text }),
      tx.objectStore('cursors').put(initialCursor(doc.id)),
      tx.done,
    ]);

    return doc;
  }

  async getDocument(id: string): Promise<LingxiDocument | undefined> {
    return this.db.get('documents', id);
  }

  async getDocumentText(id: string): Promise<string | undefined> {
    const record = await this.db.get('documentText', id);
    return record?.text;
  }

  async listDocuments(): Promise<LingxiDocument[]> {
    const all = await this.db.getAll('documents');
    return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async rename(id: string, title: string): Promise<void> {
    const doc = await this.db.get('documents', id);
    if (!doc) throw new Error(`Document not found: ${id}`);
    await this.db.put('documents', { ...doc, title });
  }

  async touchLastOpened(id: string): Promise<void> {
    const doc = await this.db.get('documents', id);
    if (!doc) throw new Error(`Document not found: ${id}`);
    await this.db.put('documents', { ...doc, lastOpenedAt: Date.now() });
  }

  async deleteDocument(id: string): Promise<void> {
    const tx = this.db.transaction(['documents', 'documentText', 'cursors', 'sourceFiles'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').delete(id),
      tx.objectStore('documentText').delete(id),
      tx.objectStore('cursors').delete(id),
      tx.objectStore('sourceFiles').delete(id),
      tx.done,
    ]);
  }

  async saveCursor(cursor: ReadingCursor): Promise<void> {
    await this.db.put('cursors', cursor);
  }

  async getCursor(documentId: string): Promise<ReadingCursor | undefined> {
    return this.db.get('cursors', documentId);
  }
}
