import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioLibraryRepository } from '../src/storage/audioLibrary';
import { openLingxiDB, type LingxiDB } from '../src/storage/db';
import type { AudioItemRecord } from '../src/storage/records';

let db: IDBPDatabase<LingxiDB>;
let repo: AudioLibraryRepository;

beforeEach(async () => {
  db = await openLingxiDB(`test-db-${crypto.randomUUID()}`);
  repo = new AudioLibraryRepository(db);
});

afterEach(() => {
  db.close();
});

function sampleItem(overrides: Partial<AudioItemRecord> = {}): AudioItemRecord {
  return {
    id: crypto.randomUUID(),
    kind: 'imported',
    title: 'My audio',
    createdAt: Date.now(),
    lastPlayedAt: null,
    sizeBytes: 1000,
    durationMs: 60_000,
    audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/mpeg' }),
    mimeType: 'audio/mpeg',
    positionMs: 0,
    rate: 1,
    subtitlesOn: false,
    subtitleFilename: null,
    subtitleText: null,
    documentId: null,
    voiceURI: null,
    chapterLabel: null,
    ...overrides,
  };
}

describe('AudioLibraryRepository', () => {
  it('round-trips an audio item', async () => {
    const item = sampleItem({ title: 'Imported file' });
    await repo.saveAudioItem(item);
    const fetched = await repo.getAudioItem(item.id);
    expect(fetched?.title).toBe('Imported file');
    expect(fetched?.audioBlob.size).toBe(item.audioBlob.size);
  });

  it('returns undefined for a missing id', async () => {
    expect(await repo.getAudioItem('missing')).toBeUndefined();
  });

  it('lists every saved item', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'a' }));
    await repo.saveAudioItem(sampleItem({ id: 'b' }));
    const all = await repo.listAudioItems();
    expect(all.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('updateAudioItemPosition merges onto the existing record without touching other fields', async () => {
    const item = sampleItem({ id: 'x', rate: 1.5, subtitlesOn: true });
    await repo.saveAudioItem(item);
    await repo.updateAudioItemPosition('x', 42_000);

    const fetched = await repo.getAudioItem('x');
    expect(fetched?.positionMs).toBe(42_000);
    expect(fetched?.rate).toBe(1.5);
    expect(fetched?.subtitlesOn).toBe(true);
    expect(fetched?.lastPlayedAt).not.toBeNull();
  });

  it('updateAudioItemPosition on a missing id is a no-op, not an error', async () => {
    await expect(repo.updateAudioItemPosition('missing', 1000)).resolves.toBeUndefined();
  });

  it('updateAudioItemSettings merges a partial update', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'y', rate: 1, subtitlesOn: false }));
    await repo.updateAudioItemSettings('y', { rate: 2 });
    const fetched = await repo.getAudioItem('y');
    expect(fetched?.rate).toBe(2);
    expect(fetched?.subtitlesOn).toBe(false);
  });

  it('updateAudioItemSettings can also set title and subtitle fields (rename + attach subtitles)', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'w', title: 'Old title' }));
    await repo.updateAudioItemSettings('w', { title: 'New title', subtitleFilename: 'book.srt', subtitleText: '1\n00:00:00,000 --> 00:00:01,000\nHi\n' });
    const fetched = await repo.getAudioItem('w');
    expect(fetched?.title).toBe('New title');
    expect(fetched?.subtitleFilename).toBe('book.srt');
    expect(fetched?.subtitleText).toContain('Hi');
  });

  it('deleteAudioItem removes the item and returns its size', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'z', sizeBytes: 5000 }));
    const freed = await repo.deleteAudioItem('z');
    expect(freed).toBe(5000);
    expect(await repo.getAudioItem('z')).toBeUndefined();
  });

  it('deleteAudioItem on a missing id returns 0', async () => {
    expect(await repo.deleteAudioItem('missing')).toBe(0);
  });

  it('deleteAllByKind only removes items of that kind and sums their size', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'book-1', kind: 'book', sizeBytes: 100 }));
    await repo.saveAudioItem(sampleItem({ id: 'book-2', kind: 'book', sizeBytes: 200 }));
    await repo.saveAudioItem(sampleItem({ id: 'imported-1', kind: 'imported', sizeBytes: 50 }));

    const freed = await repo.deleteAllByKind('book');
    expect(freed).toBe(300);

    const remaining = await repo.listAudioItems();
    expect(remaining.map((i) => i.id)).toEqual(['imported-1']);
  });

  it('deleteMany removes exactly the given ids and sums their size', async () => {
    await repo.saveAudioItem(sampleItem({ id: 'a', sizeBytes: 10 }));
    await repo.saveAudioItem(sampleItem({ id: 'b', sizeBytes: 20 }));
    await repo.saveAudioItem(sampleItem({ id: 'c', sizeBytes: 30 }));

    const freed = await repo.deleteMany(['a', 'c']);
    expect(freed).toBe(40);

    const remaining = await repo.listAudioItems();
    expect(remaining.map((i) => i.id)).toEqual(['b']);
  });
});
