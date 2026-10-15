import type { DocumentStructure, SentenceRef, WordRef } from '../model/types';
import { normalizeLineWraps } from '../segmentation/segmentText';
import { shouldSkipSentenceForSpeech } from './speechFilter';

// Default target size (chars) for one TTS utterance / cache entry — see
// PlaybackController's chunking note and ARCHITECTURE.md's TTS chunking
// section. Defined once here (not duplicated) because CachingTTSEngine's
// cache key is a hash of a chunk's text: live playback (PlaybackController)
// and the offline-download/export pipeline must derive byte-identical chunks
// for the same document/voice/rate, or their cache entries silently miss
// each other instead of sharing work.
export const DEFAULT_CHUNK_TARGET_CHARS = 900;

export interface ChunkRef {
  text: string;
  chunkWords: WordRef[];
  firstSentenceIndex: number;
  lastSentenceIndex: number;
}

// Live-playback-only behaviors (Listening settings) — in practice only
// PlaybackController ever sets either, never buildChunkSequence's own
// callers (offline-download/export): exports are a fixed snapshot with no
// "pause" concept, and letting a content filter shift export's chunk
// boundaries would needlessly diverge its cache keys from ordinary
// playback's for no benefit. Both default to off.
export interface ChunkWalkOptions {
  // A chunk never crosses into a sentence whose paragraphIndex differs from
  // the chunk's own start — every chunk boundary becomes a real paragraph
  // boundary, so "pause between paragraphs" can rely on "chunk ended" always
  // meaning "paragraph ended".
  stopAtParagraphBoundary?: boolean;
  // Sentences matching shouldSkipSentenceForSpeech are treated exactly like
  // a sentence with no words (see findSentenceWithWords below) — invisible
  // to chunk boundaries on *both* sides, so their text is never captured by
  // any chunk's slice and they're simply never spoken. Still rendered
  // normally in WordText.tsx, which reads the original document text
  // directly and knows nothing about this filter. The literal sentence a
  // caller starts a chunk at (buildChunkFromWord's startWord) is never
  // itself filtered, even if it matches — a user who explicitly seeks to a
  // "Page 12" line should still hear it, not have playback silently jump
  // past it.
  skipArtifacts?: boolean;
}

function isSentenceUsable(
  structure: DocumentStructure,
  wordsBySentence: Map<number, WordRef[]>,
  index: number,
  skipArtifacts: boolean | undefined,
): boolean {
  if (!wordsBySentence.has(index)) return false;
  if (!skipArtifacts) return true;
  const sentence = structure.sentences[index];
  return !sentence || !shouldSkipSentenceForSpeech(sentence);
}

function findSentenceWithWords(
  structure: DocumentStructure,
  wordsBySentence: Map<number, WordRef[]>,
  start: number,
  step: 1 | -1,
  skipArtifacts?: boolean,
): number | null {
  let index = start;
  while (index >= 0 && index < structure.sentences.length) {
    if (isSentenceUsable(structure, wordsBySentence, index, skipArtifacts)) return index;
    index += step;
  }
  return null;
}

// Groups consecutive sentences starting at (startCharOffset, startSentenceIndex)
// into one chunk of up to ~chunkTargetChars, always including at least the
// first sentence and never splitting a later one mid-way. Shared core of
// both buildChunkFromWord (an arbitrary resume point, possibly mid-sentence)
// and buildChunkSequence (always sentence-aligned, whole-document).
function walkChunk(
  structure: DocumentStructure,
  documentText: string,
  wordsBySentence: Map<number, WordRef[]>,
  startCharOffset: number,
  startSentenceIndex: number,
  chunkTargetChars: number,
  options: ChunkWalkOptions,
): ChunkRef {
  const chunkWords: WordRef[] = [];
  // Only built up (and only used for the final text) when skipArtifacts
  // actually bridges over a filtered sentence — see below. The common path
  // (no options, or a skip never happens) keeps using the original single
  // slice unchanged, preserving existing cache-key behavior exactly.
  const includedSegments: string[] = [];
  let sentenceIndex = startSentenceIndex;
  let lastSentenceIndex = sentenceIndex;
  let accumulatedLength = 0;
  let bridgedAGap = false;
  const startParagraphIndex = structure.sentences[startSentenceIndex]?.paragraphIndex;

  while (true) {
    const sentence = structure.sentences[sentenceIndex];
    const words = wordsBySentence.get(sentenceIndex);
    if (sentence && words) {
      chunkWords.push(...words);
      // The literal first sentence may start mid-way through (a resume
      // point) — only it needs a slice from startCharOffset; every later
      // included sentence can use its own full text.
      includedSegments.push(sentenceIndex === startSentenceIndex ? documentText.slice(startCharOffset, sentence.charEnd) : sentence.text);
      lastSentenceIndex = sentenceIndex;
      accumulatedLength = sentence.charEnd - startCharOffset;
    }
    if (accumulatedLength >= chunkTargetChars) break;

    const next = findSentenceWithWords(structure, wordsBySentence, sentenceIndex + 1, 1, options.skipArtifacts);
    if (next === null) break;
    if (options.stopAtParagraphBoundary && structure.sentences[next]?.paragraphIndex !== startParagraphIndex) break;
    // A skipArtifacts search can jump past one or more filtered sentences
    // that *do* have real words — unlike the pre-existing "sentence with no
    // words" gaps this search already skipped, those aren't silent, so
    // bridging over them with a single raw slice would leak their text
    // straight into the TTS input. Switch to building text from only the
    // sentences actually included instead.
    if (options.skipArtifacts && next !== sentenceIndex + 1) bridgedAGap = true;
    sentenceIndex = next;
  }

  const lastSentence = structure.sentences[lastSentenceIndex] as SentenceRef;
  const rawText = bridgedAGap ? includedSegments.join(' ') : documentText.slice(startCharOffset, lastSentence.charEnd);
  return {
    text: normalizeLineWraps(rawText),
    chunkWords,
    firstSentenceIndex: startSentenceIndex,
    lastSentenceIndex,
  };
}

function buildWordsBySentence(structure: DocumentStructure): Map<number, WordRef[]> {
  const map = new Map<number, WordRef[]>();
  for (const word of structure.words) {
    let bucket = map.get(word.sentenceIndex);
    if (!bucket) {
      bucket = [];
      map.set(word.sentenceIndex, bucket);
    }
    bucket.push(word);
  }
  return map;
}

// Builds the chunk that starts exactly at `startWord` — which may sit
// mid-sentence (resuming playback after a pause). Used by
// PlaybackController, which already maintains its own wordsBySentence map
// across many calls; pass it in rather than rebuilding per call.
export function buildChunkFromWord(
  structure: DocumentStructure,
  documentText: string,
  wordsBySentence: Map<number, WordRef[]>,
  startWord: WordRef,
  chunkTargetChars: number,
  options: ChunkWalkOptions = {},
): ChunkRef {
  return walkChunk(structure, documentText, wordsBySentence, startWord.charStart, startWord.sentenceIndex, chunkTargetChars, options);
}

// The canonical, deterministic chunk sequence for an entire document —
// always starting at a sentence's first word, never at a mid-sentence resume
// point. Reading a document straight through from its very first word via
// PlaybackController (i.e. never pausing mid-chunk, and with both
// ChunkWalkOptions off — see their own doc comment) produces this exact same
// sequence one chunk at a time, which is what lets offline-download and
// export (built on this function) share cache entries with live playback
// instead of re-synthesizing everything at a different granularity.
export function buildChunkSequence(
  structure: DocumentStructure,
  documentText: string,
  chunkTargetChars: number = DEFAULT_CHUNK_TARGET_CHARS,
  options: ChunkWalkOptions = {},
): ChunkRef[] {
  const wordsBySentence = buildWordsBySentence(structure);
  const chunks: ChunkRef[] = [];

  let sentenceIndex = findSentenceWithWords(structure, wordsBySentence, 0, 1, options.skipArtifacts);
  while (sentenceIndex !== null) {
    const sentence = structure.sentences[sentenceIndex] as SentenceRef;
    const chunk = walkChunk(structure, documentText, wordsBySentence, sentence.charStart, sentenceIndex, chunkTargetChars, options);
    chunks.push(chunk);
    sentenceIndex = findSentenceWithWords(structure, wordsBySentence, chunk.lastSentenceIndex + 1, 1, options.skipArtifacts);
  }

  return chunks;
}
