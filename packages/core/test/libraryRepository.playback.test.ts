import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LingxiDB } from '../src/storage/db';
import { openLingxiDB } from '../src/storage/db';
import { LibraryRepository } from '../src/storage/libraryRepository';

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

describe('LibraryRepository playback settings', () => {
  it('defaults voice to null and speed to 1 for a document with no settings saved yet', async () => {
    const doc = await repo.createFromPastedText('Doc', 'Some text here.');
    const settings = await repo.getPlaybackSettings(doc.id);
    expect(settings).toEqual({ documentId: doc.id, selectedVoiceURI: null, playbackSpeed: 1 });
  });

  it('saves and retrieves playback settings', async () => {
    const doc = await repo.createFromPastedText('Doc', 'Some text here.');
    await repo.savePlaybackSettings(doc.id, { selectedVoiceURI: 'voice-1', playbackSpeed: 1.5 });

    const settings = await repo.getPlaybackSettings(doc.id);
    expect(settings.selectedVoiceURI).toBe('voice-1');
    expect(settings.playbackSpeed).toBe(1.5);
  });

  it('does not clobber saved settings when only the cursor is updated afterward', async () => {
    const doc = await repo.createFromPastedText('Doc', 'One two three. Four five six.');
    await repo.savePlaybackSettings(doc.id, { selectedVoiceURI: 'voice-1', playbackSpeed: 1.5 });

    const currentCursor = await repo.getCursor(doc.id);
    if (!currentCursor) throw new Error('expected a cursor');
    await repo.saveCursor({ ...currentCursor, wordIndex: 3, charOffset: 10 });

    const settings = await repo.getPlaybackSettings(doc.id);
    expect(settings.selectedVoiceURI).toBe('voice-1');
    expect(settings.playbackSpeed).toBe(1.5);

    const cursor = await repo.getCursor(doc.id);
    expect(cursor?.wordIndex).toBe(3);
  });

  it('does not clobber the cursor when only settings are updated afterward', async () => {
    const doc = await repo.createFromPastedText('Doc', 'One two three. Four five six.');
    const currentCursor = await repo.getCursor(doc.id);
    if (!currentCursor) throw new Error('expected a cursor');
    await repo.saveCursor({ ...currentCursor, wordIndex: 2, charOffset: 8 });

    await repo.savePlaybackSettings(doc.id, { playbackSpeed: 2 });

    const cursor = await repo.getCursor(doc.id);
    expect(cursor?.wordIndex).toBe(2);
    expect(cursor?.charOffset).toBe(8);
  });

  it('persists playback settings and cursor together across a fresh database connection', async () => {
    const doc = await repo.createFromPastedText('Doc', 'One two three. Four five six.');
    await repo.savePlaybackSettings(doc.id, { selectedVoiceURI: 'voice-x', playbackSpeed: 1.25 });
    const currentCursor = await repo.getCursor(doc.id);
    if (!currentCursor) throw new Error('expected a cursor');
    await repo.saveCursor({ ...currentCursor, wordIndex: 4, charOffset: 20 });

    db.close();
    const reopened = await openLingxiDB(dbName);
    const reopenedRepo = new LibraryRepository(reopened);

    const settings = await reopenedRepo.getPlaybackSettings(doc.id);
    const cursor = await reopenedRepo.getCursor(doc.id);

    expect(settings.selectedVoiceURI).toBe('voice-x');
    expect(settings.playbackSpeed).toBe(1.25);
    expect(cursor?.wordIndex).toBe(4);

    reopened.close();
  });
});
