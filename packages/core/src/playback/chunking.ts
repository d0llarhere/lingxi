import type { DocumentStructure, SentenceRef, WordRef } from '../model/types';
import { normalizeLineWraps } from '../segmentation/segmentText';

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

function findSentenceWithWords(
  structure: DocumentStructure,
  wordsBySentence: Map<number, WordRef[]>,
  start: number,
  step: 1 | -1,
): number | null {
  let index = start;
  while (index >= 0 && index < structure.sentences.length) {
    if (wordsBySentence.has(index)) return index;
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
): ChunkRef {
  const chunkWords: WordRef[] = [];
  let sentenceIndex = startSentenceIndex;
  let lastSentenceIndex = sentenceIndex;
  let accumulatedLength = 0;

  while (true) {
    const sentence = structure.sentences[sentenceIndex];
    const words = wordsBySentence.get(sentenceIndex);
    if (sentence && words) {
      chunkWords.push(...words);
      lastSentenceIndex = sentenceIndex;
      accumulatedLength = sentence.charEnd - startCharOffset;
    }
    if (accumulatedLength >= chunkTargetChars) break;

    const next = findSentenceWithWords(structure, wordsBySentence, sentenceIndex + 1, 1);
    if (next === null) break;
    sentenceIndex = next;
  }

  const lastSentence = structure.sentences[lastSentenceIndex] as SentenceRef;
  const rawText = documentText.slice(startCharOffset, lastSentence.charEnd);
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
): ChunkRef {
  return walkChunk(structure, documentText, wordsBySentence, startWord.charStart, startWord.sentenceIndex, chunkTargetChars);
}

// The canonical, deterministic chunk sequence for an entire document —
// always starting at a sentence's first word, never at a mid-sentence resume
// point. Reading a document straight through from its very first word via
// PlaybackController (i.e. never pausing mid-chunk) produces this exact same
// sequence one chunk at a time, which is what lets offline-download and
// export (built on this function) share cache entries with live playback
// instead of re-synthesizing everything at a different granularity.
export function buildChunkSequence(
  structure: DocumentStructure,
  documentText: string,
  chunkTargetChars: number = DEFAULT_CHUNK_TARGET_CHARS,
): ChunkRef[] {
  const wordsBySentence = buildWordsBySentence(structure);
  const chunks: ChunkRef[] = [];

  let sentenceIndex = findSentenceWithWords(structure, wordsBySentence, 0, 1);
  while (sentenceIndex !== null) {
    const sentence = structure.sentences[sentenceIndex] as SentenceRef;
    const chunk = walkChunk(structure, documentText, wordsBySentence, sentence.charStart, sentenceIndex, chunkTargetChars);
    chunks.push(chunk);
    sentenceIndex = findSentenceWithWords(structure, wordsBySentence, chunk.lastSentenceIndex + 1, 1);
  }

  return chunks;
}
