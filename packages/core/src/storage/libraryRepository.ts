import type { IDBPDatabase } from 'idb';
import { extractPdfText } from '../extraction/extractPdf';
import type { LingxiDocument, PlaybackSettings, ReadingCursor } from '../model/types';
import { segmentText } from '../segmentation/segmentText';
import type { CursorRecord, LingxiDB } from './db';

const DEFAULT_PLAYBACK_SPEED = 1;

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.pdf$/i, '');
  return withoutExtension.trim().length > 0 ? withoutExtension : filename;
}

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

  // Extraction runs to completion before any IndexedDB write is issued, so a
  // malformed PDF (extraction throws) leaves nothing persisted.
  async createFromPdf(file: File): Promise<LingxiDocument> {
    const arrayBuffer = await file.arrayBuffer();
    const { text, pages, hasText } = await extractPdfText(arrayBuffer);

    const now = Date.now();
    const doc: LingxiDocument = {
      id: crypto.randomUUID(),
      title: titleFromFilename(file.name),
      sourceType: 'pdf',
      originalFilename: file.name,
      createdAt: now,
      lastOpenedAt: now,
      extractionStatus: hasText ? 'ok' : 'no-text',
      structure: segmentText(text, pages),
    };

    const tx = this.db.transaction(['documents', 'documentText', 'cursors', 'sourceFiles'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').put(doc),
      tx.objectStore('documentText').put({ documentId: doc.id, text }),
      tx.objectStore('cursors').put(initialCursor(doc.id)),
      tx.objectStore('sourceFiles').put({
        documentId: doc.id,
        blob: file,
        filename: file.name,
        mimeType: file.type || 'application/pdf',
      }),
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

  // Also deletes every downloaded/imported audio item generated from this
  // book (via the `documentId` index — see db.ts). The low-level per-chunk
  // TTS cache (segmentCache) is deliberately NOT touched here: it's
  // content-addressed with no document back-reference by design (see
  // segmentCache.ts), so there's no reliable way to know which entries
  // belong to this document without re-deriving every chunk for every
  // voice ever used. That cache is reclaimed generically instead, via
  // Settings→Storage's "Cache → Clear".
  async deleteDocument(id: string): Promise<void> {
    const tx = this.db.transaction(['documents', 'documentText', 'cursors', 'sourceFiles', 'audioItems'], 'readwrite');
    const audioItemIds = await tx.objectStore('audioItems').index('documentId').getAllKeys(id);
    await Promise.all([
      tx.objectStore('documents').delete(id),
      tx.objectStore('documentText').delete(id),
      tx.objectStore('cursors').delete(id),
      tx.objectStore('sourceFiles').delete(id),
      ...audioItemIds.map((audioItemId) => tx.objectStore('audioItems').delete(audioItemId)),
      tx.done,
    ]);
  }

  // Merges onto the existing record rather than overwriting it outright, so
  // frequent position-only writes (every confirmed word boundary during
  // playback) never clobber a previously saved voice/speed selection.
  async saveCursor(cursor: ReadingCursor): Promise<void> {
    const existing = await this.db.get('cursors', cursor.documentId);
    const record: CursorRecord = { ...existing, ...cursor };
    await this.db.put('cursors', record);
  }

  async getCursor(documentId: string): Promise<ReadingCursor | undefined> {
    return this.db.get('cursors', documentId);
  }

  async savePlaybackSettings(
    documentId: string,
    settings: Partial<Pick<PlaybackSettings, 'selectedVoiceURI' | 'playbackSpeed'>>,
  ): Promise<void> {
    const existing = await this.db.get('cursors', documentId);
    if (!existing) throw new Error(`No cursor record for document: ${documentId}`);
    await this.db.put('cursors', { ...existing, ...settings });
  }

  // Defaults fill in for cursor records written before Phase 3, which never
  // stored voice/speed.
  async getPlaybackSettings(documentId: string): Promise<PlaybackSettings> {
    const record = await this.db.get('cursors', documentId);
    return {
      documentId,
      selectedVoiceURI: record?.selectedVoiceURI ?? null,
      playbackSpeed: record?.playbackSpeed ?? DEFAULT_PLAYBACK_SPEED,
    };
  }
}
