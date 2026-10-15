import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioLibraryRepository } from '../src/storage/audioLibrary';
import type { LingxiDB } from '../src/storage/db';
import { openLingxiDB } from '../src/storage/db';
import { LibraryRepository } from '../src/storage/libraryRepository';
import type { AudioItemRecord } from '../src/storage/records';
import { SegmentCacheRepository, type SegmentCacheRecord } from '../src/storage/segmentCache';

let dbName: string;
let db: IDBPDatabase<LingxiDB>;
let repo: LibraryRepository;

beforeEach(async () => {
  dbName = `test-db-${crypto.randomUUID()}`;
  db = await openLingxiDB(dbName);
  repo = new LibraryRepository(db);
});

afterEach(() => {
  db.close();
});

describe('LibraryRepository', () => {
  it('creates a pasted-text document with a segmented structure', async () => {
    const doc = await repo.createFromPastedText('My Doc', 'Hello world. This is Lingxi.');
    expect(doc.id).toBeTruthy();
    expect(doc.sourceType).toBe('pasted-text');
    expect(doc.extractionStatus).toBe('ok');
    expect(doc.structure.pages).toHaveLength(1);
    expect(doc.structure.sentences.length).toBe(2);
    expect(doc.structure.words.length).toBeGreaterThan(0);
  });

  it('applies Listening settings\' default voice/speed to a new document, when given', async () => {
    const doc = await repo.createFromPastedText('My Doc', 'Hello world.', 'kokoro:af_bella', 1.25);
    const settings = await repo.getPlaybackSettings(doc.id);
    expect(settings.selectedVoiceURI).toBe('kokoro:af_bella');
    expect(settings.playbackSpeed).toBe(1.25);
  });

  it('falls back to the usual defaults when no default voice/speed is given', async () => {
    const doc = await repo.createFromPastedText('My Doc', 'Hello world.');
    const settings = await repo.getPlaybackSettings(doc.id);
    expect(settings.selectedVoiceURI).toBeNull();
    expect(settings.playbackSpeed).toBe(1);
  });

  it('retrieves a stored document and its text', async () => {
    const doc = await repo.createFromPastedText('Doc', 'Some content here.');
    const fetched = await repo.getDocument(doc.id);
    const text = await repo.getDocumentText(doc.id);
    expect(fetched?.title).toBe('Doc');
    expect(text).toBe('Some content here.');
  });

  it('lists document metadata without needing the full text store', async () => {
    await repo.createFromPastedText('A', 'a'.repeat(10));
    await repo.createFromPastedText('B', 'b'.repeat(10));
    const list = await repo.listDocuments();
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.title).sort()).toEqual(['A', 'B']);
    const first = list[0];
    expect(first).toBeDefined();
    expect(Object.hasOwn(first as object, 'text')).toBe(false);
  });

  it('renames a document', async () => {
    const doc = await repo.createFromPastedText('Old Title', 'text');
    await repo.rename(doc.id, 'New Title');
    const fetched = await repo.getDocument(doc.id);
    expect(fetched?.title).toBe('New Title');
  });

  it('deletes a document and all associated data', async () => {
    const doc = await repo.createFromPastedText('Doc', 'text to remove');
    await repo.deleteDocument(doc.id);
    expect(await repo.getDocument(doc.id)).toBeUndefined();
    expect(await repo.getDocumentText(doc.id)).toBeUndefined();
    expect(await repo.getCursor(doc.id)).toBeUndefined();
  });

  it('getBookFilesSize sums every document text (pasted-text has no sourceFiles blob)', async () => {
    await repo.createFromPastedText('Doc', 'Hello world');
    const size = await repo.getBookFilesSize();
    expect(size).toBe(new Blob(['Hello world']).size);
  });

  it('creates an initial reading cursor alongside the document', async () => {
    const doc = await repo.createFromPastedText('Doc', 'One. Two. Three.');
    const cursor = await repo.getCursor(doc.id);
    expect(cursor).toBeDefined();
    expect(cursor?.documentId).toBe(doc.id);
    expect(cursor?.wordIndex).toBe(0);
  });

  it('updates an existing cursor in place', async () => {
    const doc = await repo.createFromPastedText('Doc', 'One. Two. Three. Four.');
    const targetWord = doc.structure.words[2];
    if (!targetWord) throw new Error('expected a word at index 2');

    await repo.saveCursor({
      documentId: doc.id,
      wordIndex: targetWord.index,
      charOffset: targetWord.charStart,
      pageIndex: targetWord.pageIndex,
      paragraphIndex: targetWord.paragraphIndex,
      sentenceIndex: targetWord.sentenceIndex,
      updatedAt: Date.now(),
    });

    const updated = await repo.getCursor(doc.id);
    expect(updated?.wordIndex).toBe(targetWord.index);
    expect(updated?.charOffset).toBe(targetWord.charStart);
    expect(updated?.sentenceIndex).toBe(targetWord.sentenceIndex);
  });

  it('persists data across a fresh database connection (simulated app close/reopen)', async () => {
    const doc = await repo.createFromPastedText('Persisted', 'Persisted content across reopen.');
    await repo.saveCursor({
      documentId: doc.id,
      wordIndex: 1,
      charOffset: 10,
      pageIndex: 0,
      paragraphIndex: 0,
      sentenceIndex: 0,
      updatedAt: Date.now(),
    });

    db.close();

    const reopened = await openLingxiDB(dbName);
    const reopenedRepo = new LibraryRepository(reopened);
    const fetchedDoc = await reopenedRepo.getDocument(doc.id);
    const fetchedCursor = await reopenedRepo.getCursor(doc.id);

    expect(fetchedDoc?.title).toBe('Persisted');
    expect(fetchedCursor?.wordIndex).toBe(1);
    expect(fetchedCursor?.charOffset).toBe(10);

    reopened.close();
  });

  it('keeps multiple documents and their cursors independent', async () => {
    const docA = await repo.createFromPastedText('A', 'Text A one. Text A two.');
    const docB = await repo.createFromPastedText('B', 'Text B one. Text B two.');

    await repo.saveCursor({
      documentId: docA.id,
      wordIndex: 1,
      charOffset: 5,
      pageIndex: 0,
      paragraphIndex: 0,
      sentenceIndex: 0,
      updatedAt: Date.now(),
    });

    const cursorA = await repo.getCursor(docA.id);
    const cursorB = await repo.getCursor(docB.id);
    expect(cursorA?.wordIndex).toBe(1);
    expect(cursorB?.wordIndex).toBe(0);

    const list = await repo.listDocuments();
    expect(list).toHaveLength(2);
  });

  it('handles an empty pasted-text document without crashing', async () => {
    const doc = await repo.createFromPastedText('Empty', '');
    expect(doc.structure.words).toHaveLength(0);
    expect(doc.structure.sentences).toHaveLength(0);

    const cursor = await repo.getCursor(doc.id);
    expect(cursor?.wordIndex).toBe(0);

    const text = await repo.getDocumentText(doc.id);
    expect(text).toBe('');
  });

  it('handles long text without error', async () => {
    const longText = Array.from({ length: 1500 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const doc = await repo.createFromPastedText('Long', longText);
    expect(doc.structure.sentences.length).toBe(1500);
    expect(doc.structure.words.length).toBeGreaterThan(1500 * 3);

    const text = await repo.getDocumentText(doc.id);
    expect(text?.length).toBe(longText.length);
  });
});

describe('LibraryRepository.deleteDocument cascade', () => {
  function sampleAudioItem(overrides: Partial<AudioItemRecord> = {}): AudioItemRecord {
    return {
      id: crypto.randomUUID(),
      kind: 'book',
      title: 'Book audio',
      createdAt: Date.now(),
      lastPlayedAt: null,
      sizeBytes: 100,
      durationMs: 1000,
      audioBlob: new Blob([new Uint8Array(4)]),
      mimeType: 'audio/wav',
      positionMs: 0,
      rate: 1,
      subtitlesOn: false,
      subtitleFilename: null,
      subtitleText: null,
      documentId: null,
      voiceURI: 'kokoro:af_bella',
      chapterLabel: 'Whole book',
      ...overrides,
    };
  }

  function sampleSegment(overrides: Partial<SegmentCacheRecord> = {}): SegmentCacheRecord {
    return {
      key: crypto.randomUUID(),
      text: 'Some chunk.',
      audioBlob: new Blob([new Uint8Array(4)]),
      words: [],
      engine: 'kokoro',
      durationMs: 500,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  it('deletes every audio item generated from the document, but leaves other documents\' items alone', async () => {
    const audioRepo = new AudioLibraryRepository(db);
    const doc = await repo.createFromPastedText('Doc A', 'Some content.');
    const otherDoc = await repo.createFromPastedText('Doc B', 'Other content.');

    await audioRepo.saveAudioItem(sampleAudioItem({ id: 'a-1', documentId: doc.id }));
    await audioRepo.saveAudioItem(sampleAudioItem({ id: 'a-2', documentId: doc.id }));
    await audioRepo.saveAudioItem(sampleAudioItem({ id: 'b-1', documentId: otherDoc.id }));
    await audioRepo.saveAudioItem(sampleAudioItem({ id: 'imported-1', kind: 'imported', documentId: null }));

    await repo.deleteDocument(doc.id);

    const remaining = await audioRepo.listAudioItems();
    expect(remaining.map((item) => item.id).sort()).toEqual(['b-1', 'imported-1']);
  });

  it('does not touch the per-chunk segment cache (content-addressed, no document identity)', async () => {
    const segmentRepo = new SegmentCacheRepository(db);
    const doc = await repo.createFromPastedText('Doc C', 'Some content.');
    await segmentRepo.putSegment(sampleSegment({ key: 'chunk-1' }));

    await repo.deleteDocument(doc.id);

    expect(await segmentRepo.getSegment('chunk-1')).toBeDefined();
  });
});
