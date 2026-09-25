import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LingxiDB } from '../src/storage/db';
import { openLingxiDB } from '../src/storage/db';
import { LibraryRepository } from '../src/storage/libraryRepository';
import { buildMinimalPdf } from './fixtures/buildMinimalPdf';

function pdfFile(name: string, pages: string[][]): File {
  const bytes = new Uint8Array(buildMinimalPdf(pages));
  return new File([bytes], name, { type: 'application/pdf' });
}

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

describe('LibraryRepository.createFromPdf', () => {
  it('creates a pdf document with a title derived from the filename', async () => {
    const doc = await repo.createFromPdf(pdfFile('My Report.pdf', [['Some report content.']]));

    expect(doc.sourceType).toBe('pdf');
    expect(doc.title).toBe('My Report');
    expect(doc.originalFilename).toBe('My Report.pdf');
    expect(doc.extractionStatus).toBe('ok');
  });

  it('builds a multi-page structure with correct per-page word assignment', async () => {
    const doc = await repo.createFromPdf(
      pdfFile('multi.pdf', [['Content on page one.'], ['Content on page two.']]),
    );

    expect(doc.structure.pages).toHaveLength(2);
    const pageIndexesUsedByWords = new Set(doc.structure.words.map((w) => w.pageIndex));
    expect(pageIndexesUsedByWords.has(0)).toBe(true);
    expect(pageIndexesUsedByWords.has(1)).toBe(true);
  });

  it('persists the original PDF blob in the sourceFiles store', async () => {
    const file = pdfFile('archive.pdf', [['Archived content.']]);
    const doc = await repo.createFromPdf(file);

    const stored = await db.get('sourceFiles', doc.id);
    expect(stored).toBeDefined();
    expect(stored?.filename).toBe('archive.pdf');
    expect(stored?.mimeType).toBe('application/pdf');
    expect(stored?.blob.size).toBe(file.size);
  });

  it('creates an initial reading cursor for a pdf document, same as pasted text', async () => {
    const doc = await repo.createFromPdf(pdfFile('cursor.pdf', [['Cursor test content.']]));
    const cursor = await repo.getCursor(doc.id);
    expect(cursor?.wordIndex).toBe(0);
    expect(cursor?.documentId).toBe(doc.id);
  });

  it('marks a scanned/image-only PDF as no-text but still stores it', async () => {
    const doc = await repo.createFromPdf(pdfFile('scanned.pdf', [[]]));

    expect(doc.extractionStatus).toBe('no-text');
    expect(doc.structure.words).toHaveLength(0);

    // Still persisted, including the source file, so it shows up in the
    // library and the original can be revisited later.
    const stored = await db.get('sourceFiles', doc.id);
    expect(stored).toBeDefined();
    const text = await repo.getDocumentText(doc.id);
    expect(text).toBe('');
  });

  it('persists nothing when the PDF is malformed', async () => {
    const before = await repo.listDocuments();
    const badFile = new File([new TextEncoder().encode('not a pdf')], 'bad.pdf', {
      type: 'application/pdf',
    });

    await expect(repo.createFromPdf(badFile)).rejects.toThrow();

    const after = await repo.listDocuments();
    expect(after).toHaveLength(before.length);
  });

  it('deletes a pdf document and its source file together', async () => {
    const doc = await repo.createFromPdf(pdfFile('delete-me.pdf', [['Content to delete.']]));
    await repo.deleteDocument(doc.id);

    expect(await repo.getDocument(doc.id)).toBeUndefined();
    expect(await repo.getDocumentText(doc.id)).toBeUndefined();
    expect(await repo.getCursor(doc.id)).toBeUndefined();
    expect(await db.get('sourceFiles', doc.id)).toBeUndefined();
  });

  it('lists pdf and pasted-text documents together', async () => {
    await repo.createFromPastedText('Pasted', 'Some pasted text.');
    await repo.createFromPdf(pdfFile('mixed.pdf', [['Mixed library content.']]));

    const list = await repo.listDocuments();
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.sourceType).sort()).toEqual(['pasted-text', 'pdf']);
  });

  it('persists a pdf document across a fresh database connection', async () => {
    const doc = await repo.createFromPdf(pdfFile('persisted.pdf', [['Persisted pdf content.']]));
    db.close();

    const reopened = await openLingxiDB(dbName);
    const reopenedRepo = new LibraryRepository(reopened);
    const fetched = await reopenedRepo.getDocument(doc.id);
    const sourceFile = await reopened.get('sourceFiles', doc.id);

    expect(fetched?.title).toBe('persisted');
    expect(sourceFile).toBeDefined();

    reopened.close();
  });
});
