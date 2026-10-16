import type { IDBPDatabase } from 'idb';
import { mergeChunkRanges, type ChunkIndexRange } from '../playback/chunkRanges';
import type { LingxiDB } from './db';
import type { AudioItemRecord } from './records';

// Records written before chunkRanges/audioReady existed are always a
// complete, real "whole book" export — defaulting them this way means every
// other method in this file (and every caller) can treat the fields as
// always present instead of threading `?? []`/`?? true` through the UI.
function normalize(record: AudioItemRecord): AudioItemRecord {
  return { ...record, chunkRanges: record.chunkRanges ?? [], audioReady: record.audioReady ?? true };
}

// CRUD for the Downloads page's audio items (see records.ts's AudioItemRecord
// doc comment for why this is a separate store/repository from the
// per-chunk TTS cache). Mirrors SegmentCacheRepository's shape: one small,
// focused repository per storage concern rather than bolting unrelated
// methods onto LibraryRepository.
export class AudioLibraryRepository {
  constructor(private readonly db: IDBPDatabase<LingxiDB>) {}

  async listAudioItems(): Promise<AudioItemRecord[]> {
    return (await this.db.getAll('audioItems')).map(normalize);
  }

  async getAudioItem(id: string): Promise<AudioItemRecord | undefined> {
    const record = await this.db.get('audioItems', id);
    return record && normalize(record);
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

  async updateAudioItemSettings(
    id: string,
    settings: Partial<Pick<AudioItemRecord, 'rate' | 'subtitlesOn' | 'title' | 'subtitleFilename' | 'subtitleText'>>,
  ): Promise<void> {
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

  // Creates (on a book's first-ever download) or updates the book+voice's
  // AudioItemRecord with a newly-downloaded chunk range merged into its
  // coverage — the single place Downloads-page "saved ranges" state is
  // written. `addedSizeBytes`/`addedDurationMs` must already reflect only
  // the genuinely new chunks (the caller computes this via
  // subtractChunkRanges against the range's *pre-existing* coverage), not
  // the whole requested range, or a re-download of overlapping chunks would
  // double-count their size. Returns the updated record's audioReady value,
  // which stays false here — becoming audioReady:true is a separate step
  // (exportAudio concatenation) run only once coverage reaches the whole
  // book.
  async mergeDownloadedRange(params: {
    id: string;
    documentId: string;
    title: string;
    voiceURI: string;
    rate: number;
    range: ChunkIndexRange;
    addedSizeBytes: number;
    addedDurationMs: number;
  }): Promise<AudioItemRecord> {
    const existing = await this.db.get('audioItems', params.id);
    const chunkRanges = mergeChunkRanges([...(existing?.chunkRanges ?? []), params.range]);
    const record: AudioItemRecord = existing
      ? {
          ...existing,
          chunkRanges,
          sizeBytes: existing.sizeBytes + params.addedSizeBytes,
          durationMs: existing.durationMs + params.addedDurationMs,
        }
      : {
          id: params.id,
          kind: 'book',
          title: params.title,
          createdAt: Date.now(),
          lastPlayedAt: null,
          sizeBytes: params.addedSizeBytes,
          durationMs: params.addedDurationMs,
          audioBlob: new Blob([], { type: 'audio/wav' }), // placeholder — never played directly while audioReady is false (see records.ts)
          mimeType: 'audio/wav',
          positionMs: 0,
          rate: params.rate,
          subtitlesOn: false,
          subtitleFilename: null,
          subtitleText: null,
          documentId: params.documentId,
          voiceURI: params.voiceURI,
          chapterLabel: null,
          chunkRanges,
          audioReady: false,
        };
    await this.db.put('audioItems', record);
    return record;
  }

  // Settings→Storage's "Clear cache" wipes the per-chunk segment cache, so
  // every book's chunkRanges coverage claim goes stale at the same moment —
  // reset it everywhere so the download dialog/Downloads page don't keep
  // claiming ranges are saved when the audio behind them is gone. Leaves
  // kind:'imported' items and any already-exported audioBlob/audioReady:true
  // book alone — a prior full export is a genuinely separate, independently
  // valid artifact that clearing the synthesis cache was never meant to
  // touch (same reasoning "Downloaded audio" is already a separate,
  // separately-deletable row from "Cache" on that page).
  async resetChunkRangesForAllBooks(): Promise<void> {
    const all = await this.db.getAll('audioItems');
    const tx = this.db.transaction('audioItems', 'readwrite');
    await Promise.all([
      ...all
        .filter((item) => item.kind === 'book' && !item.audioReady)
        .map((item) => tx.objectStore('audioItems').put({ ...item, chunkRanges: [] })),
      tx.done,
    ]);
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
