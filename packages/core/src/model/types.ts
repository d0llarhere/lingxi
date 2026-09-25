// Named LingxiDocument (not Document) to avoid shadowing the DOM's global Document type.

export type SourceType = 'pdf' | 'pasted-text';
export type ExtractionStatus = 'ok' | 'no-text' | 'error';

export interface PageRef {
  index: number;
  charStart: number;
  charEnd: number;
}

export interface ParagraphRef {
  index: number;
  pageIndex: number;
  charStart: number;
  charEnd: number;
}

export interface SentenceRef {
  index: number;
  paragraphIndex: number;
  pageIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface WordRef {
  index: number;
  sentenceIndex: number;
  paragraphIndex: number;
  pageIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

// All char offsets in every *Ref below are global offsets into the document's
// full text (kept separately in the `documentText` store). This lets any word
// resolve to its full page/paragraph/sentence path in O(1), and vice versa.
export interface DocumentStructure {
  pages: PageRef[];
  paragraphs: ParagraphRef[];
  sentences: SentenceRef[];
  words: WordRef[];
}

export interface LingxiDocument {
  id: string;
  title: string;
  sourceType: SourceType;
  originalFilename?: string;
  createdAt: number;
  lastOpenedAt: number;
  extractionStatus: ExtractionStatus;
  structure: DocumentStructure;
}

// The logical reading cursor — source of truth for playback position.
// wordIndex is the primary key (index into structure.words[]); the rest is
// denormalized from that word for explicitness, self-describing persisted
// records, and cross-checkability, per the pause/resume requirement.
export interface ReadingCursor {
  documentId: string;
  wordIndex: number;
  charOffset: number;
  pageIndex: number;
  paragraphIndex: number;
  sentenceIndex: number;
  updatedAt: number;
}

export interface PlaybackSettings {
  documentId: string;
  selectedVoiceURI: string | null;
  playbackSpeed: number;
}
