export type {
  DocumentStructure,
  ExtractionStatus,
  LingxiDocument,
  PageRef,
  ParagraphRef,
  PlaybackSettings,
  ReadingCursor,
  SentenceRef,
  SourceType,
  WordRef,
} from './model/types';
export { segmentText } from './segmentation/segmentText';
export { DB_NAME, DB_VERSION, openLingxiDB } from './storage/db';
export type { LingxiDB } from './storage/db';
export { LibraryRepository } from './storage/libraryRepository';
export type { DocumentTextRecord, SourceFileRecord } from './storage/records';
