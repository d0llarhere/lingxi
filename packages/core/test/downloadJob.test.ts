import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLingxiDB, type LingxiDB } from '../src/storage/db';
import { DownloadJobRepository, type DownloadJobRecord } from '../src/storage/downloadJob';

let db: IDBPDatabase<LingxiDB>;
let repo: DownloadJobRepository;

beforeEach(async () => {
  db = await openLingxiDB(`test-db-${crypto.randomUUID()}`);
  repo = new DownloadJobRepository(db);
});

afterEach(() => {
  db.close();
});

function sampleJob(overrides: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: crypto.randomUUID(),
    documentId: 'doc-1',
    title: 'My Book',
    voiceURI: 'kokoro:af_bella',
    rate: 1,
    fromChunkIndex: 0,
    toChunkIndex: 9,
    status: 'queued',
    error: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('DownloadJobRepository', () => {
  it('round-trips a job', async () => {
    const job = sampleJob({ id: 'a' });
    await repo.saveJob(job);
    const all = await repo.listJobs();
    expect(all).toEqual([job]);
  });

  it('saveJob overwrites by id (status transitions)', async () => {
    await repo.saveJob(sampleJob({ id: 'a', status: 'queued' }));
    await repo.saveJob(sampleJob({ id: 'a', status: 'downloading' }));
    const all = await repo.listJobs();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('downloading');
  });

  it('deleteJob removes exactly that job', async () => {
    await repo.saveJob(sampleJob({ id: 'a' }));
    await repo.saveJob(sampleJob({ id: 'b' }));
    await repo.deleteJob('a');
    const all = await repo.listJobs();
    expect(all.map((j) => j.id)).toEqual(['b']);
  });
});
