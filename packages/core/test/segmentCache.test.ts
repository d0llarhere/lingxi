import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, openLingxiDB, type LingxiDB } from '../src/storage/db';
import { SegmentCacheRepository, type SegmentCacheRecord } from '../src/storage/segmentCache';

let dbName: string;
let db: IDBPDatabase<LingxiDB>;
let repo: SegmentCacheRepository;

beforeEach(async () => {
  dbName = `test-db-${crypto.randomUUID()}`;
  db = await openLingxiDB(dbName);
  repo = new SegmentCacheRepository(db);
});

afterEach(() => {
  db.close();
});

function sampleRecord(overrides: Partial<SegmentCacheRecord> = {}): SegmentCacheRecord {
  return {
    key: 'abc123',
    text: 'Hello world.',
    audioBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }),
    words: [{ offsetMs: 0, durationMs: 300, text: 'Hello' }],
    engine: 'edge',
    durationMs: 600,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('SegmentCacheRepository', () => {
  it('returns undefined for a key that was never written', async () => {
    expect(await repo.getSegment('missing')).toBeUndefined();
  });

  it('round-trips a segment, including its Blob and word anchors', async () => {
    const record = sampleRecord();
    await repo.putSegment(record);

    const fetched = await repo.getSegment(record.key);
    expect(fetched?.text).toBe('Hello world.');
    expect(fetched?.engine).toBe('edge');
    expect(fetched?.words).toEqual(record.words);
    expect(fetched?.audioBlob.size).toBe(record.audioBlob.size);
  });

  it('overwrites an existing entry when put again with the same key', async () => {
    await repo.putSegment(sampleRecord({ durationMs: 600 }));
    await repo.putSegment(sampleRecord({ durationMs: 999 }));

    const fetched = await repo.getSegment('abc123');
    expect(fetched?.durationMs).toBe(999);
  });

  it('stores kokoro entries with empty word anchors (no real timing)', async () => {
    await repo.putSegment(sampleRecord({ key: 'kokoro-key', engine: 'kokoro', words: [] }));
    const fetched = await repo.getSegment('kokoro-key');
    expect(fetched?.engine).toBe('kokoro');
    expect(fetched?.words).toEqual([]);
  });

  it('sums every entry\'s blob size for getTotalSize', async () => {
    await repo.putSegment(sampleRecord({ key: 'a', audioBlob: new Blob([new Uint8Array(10)]) }));
    await repo.putSegment(sampleRecord({ key: 'b', audioBlob: new Blob([new Uint8Array(20)]) }));
    expect(await repo.getTotalSize()).toBe(30);
  });

  it('returns 0 from getTotalSize when empty', async () => {
    expect(await repo.getTotalSize()).toBe(0);
  });

  it('clear() wipes every entry', async () => {
    await repo.putSegment(sampleRecord({ key: 'a' }));
    await repo.putSegment(sampleRecord({ key: 'b' }));
    await repo.clear();
    expect(await repo.getSegment('a')).toBeUndefined();
    expect(await repo.getSegment('b')).toBeUndefined();
    expect(await repo.getTotalSize()).toBe(0);
  });
});

describe('DB migration (v1 -> v2)', () => {
  it('adds segmentCache without disturbing an existing v1 database', async () => {
    const migrationDbName = `test-migration-${crypto.randomUUID()}`;

    // Simulate a database created before the segmentCache store existed —
    // the exact v1 schema openLingxiDB() used to create unconditionally.
    const v1db = await openDB(migrationDbName, 1, {
      upgrade(rawDb) {
        rawDb.createObjectStore('documents', { keyPath: 'id' });
        rawDb.createObjectStore('documentText', { keyPath: 'documentId' });
        rawDb.createObjectStore('cursors', { keyPath: 'documentId' });
        rawDb.createObjectStore('sourceFiles', { keyPath: 'documentId' });
      },
    });
    await v1db.put('documents', { id: 'doc-1', title: 'Pre-existing doc' } as never);
    v1db.close();

    // Re-opening via openLingxiDB() upgrades to the current DB_VERSION.
    const upgraded = await openLingxiDB(migrationDbName);
    expect(DB_VERSION).toBeGreaterThanOrEqual(2);
    expect(upgraded.objectStoreNames.contains('segmentCache')).toBe(true);

    // Pre-existing data in the untouched stores survives the upgrade.
    const preserved = await upgraded.get('documents', 'doc-1');
    expect((preserved as { title?: string } | undefined)?.title).toBe('Pre-existing doc');

    // The new store is immediately usable.
    const cacheRepo = new SegmentCacheRepository(upgraded);
    await cacheRepo.putSegment(sampleRecord({ key: 'post-migration' }));
    expect((await cacheRepo.getSegment('post-migration'))?.text).toBe('Hello world.');

    upgraded.close();
  });

  it('uses the shared DB_NAME by default', () => {
    expect(DB_NAME).toBe('lingxi-db');
  });
});
