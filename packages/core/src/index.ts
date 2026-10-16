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
export { extractPdfText } from './extraction/extractPdf';
export type { PdfExtractionResult } from './extraction/extractPdf';
export {
  computeProgress,
  findPageIndexAtOffset,
  findWordAtOrBeforeOffset,
  findWordIndexAtOrAfterOffset,
} from './playback/cursorMath';
export { calibrateCharsPerSecond, measureCharsPerSecond } from './playback/ttsCalibration';
export { PlaybackController } from './playback/playbackController';
export type { PlaybackControllerOptions, PlaybackState } from './playback/playbackController';
export { buildChunkSequence, DEFAULT_CHUNK_TARGET_CHARS } from './playback/chunking';
export type { ChunkRef } from './playback/chunking';
export {
  chunkCharRanges,
  chunkRangeForCharOffsets,
  mergeChunkRanges,
  snapCharRangeToParagraphs,
  subtractChunkRanges,
} from './playback/chunkRanges';
export type { ChunkIndexRange, CharRange } from './playback/chunkRanges';
export type { SpeakOptions, TTSEngine, VoiceInfo } from './playback/ttsEngine';
export { DEFAULT_CHAPTER_DETECTION, detectChapters } from './segmentation/detectChapters';
export type { ChapterDetectionMode, ChapterDetectionSettings, ChapterRef } from './segmentation/detectChapters';
export { segmentText } from './segmentation/segmentText';
export { hashText } from './cache/hash';
export { DB_NAME, DB_VERSION, openLingxiDB } from './storage/db';
export type { CursorRecord, LingxiDB } from './storage/db';
export { LibraryRepository } from './storage/libraryRepository';
export type { AudioItemRecord, DocumentTextRecord, SourceFileRecord } from './storage/records';
export { SegmentCacheRepository } from './storage/segmentCache';
export type { SegmentCacheRecord, WordAnchor } from './storage/segmentCache';
export { AudioLibraryRepository } from './storage/audioLibrary';
export { DownloadJobRepository } from './storage/downloadJob';
export type { DownloadJobRecord } from './storage/downloadJob';
export { parseSrt, parseSubtitleFile, parseVtt } from './subtitles/parseSubtitles';
export type { SubtitleCue } from './subtitles/parseSubtitles';
