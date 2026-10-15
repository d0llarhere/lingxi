// Separate store records, kept out of `LingxiDocument` so the frequently-read
// metadata list never has to deserialize large text/binary payloads.

export interface DocumentTextRecord {
  documentId: string;
  text: string;
}

// Populated starting in the PDF phase; the store exists from Phase 1 so
// deletion/cleanup logic is correct even before anything writes to it.
export interface SourceFileRecord {
  documentId: string;
  blob: Blob;
  filename: string;
  mimeType: string;
}

// One row per audio item shown on the Downloads page — either generated
// from a book (via offlineDownload.ts, once a "Download for offline" run
// completes) or imported directly by the user. A flat shape rather than a
// discriminated union so an IndexedDB index on `documentId` stays simple;
// `documentId`/`voiceURI`/`chapterLabel` are only ever set for kind:'book'.
// Deliberately distinct from `segmentCache`: that store is content-
// addressed per TTS chunk with no document identity by design (see
// segmentCache.ts), while this one is the user-visible, wholesale
// downloaded/imported file — the thing Settings→Storage and
// LibraryRepository.deleteDocument() actually manage.
export interface AudioItemRecord {
  id: string;
  kind: 'book' | 'imported';
  title: string;
  createdAt: number;
  lastPlayedAt: number | null;
  sizeBytes: number;
  durationMs: number;
  audioBlob: Blob;
  mimeType: string;
  positionMs: number;
  rate: number;
  subtitlesOn: boolean;
  subtitleFilename: string | null;
  subtitleText: string | null;
  documentId: string | null;
  voiceURI: string | null;
  chapterLabel: string | null;
}
