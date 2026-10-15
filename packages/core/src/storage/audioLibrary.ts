import type { IDBPDatabase } from 'idb';
import type { LingxiDB } from './db';
import type { AudioItemRecord } from './records';

// CRUD for the Downloads page's audio items (see records.ts's AudioItemRecord
// doc comment for why this is a separate store/repository from the
// per-chunk TTS cache). Mirrors SegmentCacheRepository's shape: one small,
// focused repository per storage concern rather than bolting unrelated
// methods onto LibraryRepository.
export class AudioLibraryRepository {
  constructor(private readonly db: IDBPDatabase<LingxiDB>) {}

  async listAudioItems(): Promise<AudioItemRecord[]> {
    return this.db.getAll('audioItems');
  }

  async getAudioItem(id: string): Promise<AudioItemRecord | undefined> {
    return this.db.get('audioItems', id);
  }

  async saveAudioItem(record: AudioItemRecord): Promise<void> {
    await this.db.put('audioItems', record);
  }

  // Merges onto the existing record rather than overwriting it outright —
  // same reasoning as LibraryRepository.saveCursor: frequent position-only
  // writes (every ~5s while playing) must never clobber rate/subtitlesOn.
  async updateAudioItemPosition(id: string, positionMs: number): Promise<void> {
    const existing = await this.db.get('audioItems', id);
    if (!existing) return;
    await this.db.put('audioItems', { ...existing, positionMs, lastPlayedAt: Date.now() });
  }

  async updateAudioItemSettings(id: string, settings: Partial<Pick<AudioItemRecord, 'rate' | 'subtitlesOn'>>): Promise<void> {
    const existing = await this.db.get('audioItems', id);
    if (!existing) return;
    await this.db.put('audioItems', { ...existing, ...settings });
  }

  // Each delete method returns the total bytes freed, for the "Freed X MB"
  // toast on Settings→Storage — computed from what was actually deleted,
  // not re-derived from a separate size query afterward.
  async deleteAudioItem(id: string): Promise<number> {
    const existing = await this.db.get('audioItems', id);
    if (!existing) return 0;
    await this.db.delete('audioItems', id);
    return existing.sizeBytes;
  }

  async deleteAllByKind(kind: AudioItemRecord['kind']): Promise<number> {
    const all = await this.db.getAll('audioItems');
    const matching = all.filter((item) => item.kind === kind);
    const tx = this.db.transaction('audioItems', 'readwrite');
    await Promise.all([...matching.map((item) => tx.objectStore('audioItems').delete(item.id)), tx.done]);
    return matching.reduce((sum, item) => sum + item.sizeBytes, 0);
  }

  async deleteMany(ids: string[]): Promise<number> {
    const tx = this.db.transaction('audioItems', 'readwrite');
    const store = tx.objectStore('audioItems');
    let freedBytes = 0;
    for (const id of ids) {
      const existing = await store.get(id);
      if (existing) {
        freedBytes += existing.sizeBytes;
        await store.delete(id);
      }
    }
    await tx.done;
    return freedBytes;
  }
}
