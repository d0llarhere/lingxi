import type { DocumentStructure, ParagraphRef } from '../model/types';
import type { ChunkRef } from './chunking';

// Pure functions only, same posture as cursorMath.ts — no storage, no TTS.
// Lets Download-for-offline (and its "already saved vs new" summary) work in
// terms of chunk indices, the same unit buildChunkSequence/CachingTTSEngine
// already use, instead of inventing a second position unit.

export interface ChunkIndexRange {
  fromChunkIndex: number;
  toChunkIndex: number; // inclusive
}

export interface CharRange {
  charStart: number;
  charEnd: number;
}

// A chunk carries sentence indices, not char offsets directly (see
// ChunkRef's own doc comment) — derived once per document/voice via the
// sentences its first/last word belong to, then reused for every range
// query against that chunk sequence.
export function chunkCharRanges(chunks: ChunkRef[], structure: DocumentStructure): CharRange[] {
  return chunks.map((chunk) => ({
    charStart: structure.sentences[chunk.firstSentenceIndex]!.charStart,
    charEnd: structure.sentences[chunk.lastSentenceIndex]!.charEnd,
  }));
}

// Inclusive chunk-index span of every chunk whose char range overlaps
// [charStart, charEnd). Chunks are contiguous and sorted by position, so a
// linear scan is simplest — chunk counts are in the hundreds even for a
// long book, not a hot path.
export function chunkRangeForCharOffsets(charRanges: CharRange[], charStart: number, charEnd: number): ChunkIndexRange | null {
  let from = -1;
  let to = -1;
  for (let i = 0; i < charRanges.length; i++) {
    const range = charRanges[i]!;
    if (range.charEnd > charStart && range.charStart < charEnd) {
      if (from === -1) from = i;
      to = i;
    }
  }
  return from === -1 ? null : { fromChunkIndex: from, toChunkIndex: to };
}

// Sorts and coalesces touching/overlapping ranges into the fewest disjoint
// ranges that cover the same chunks — the shape both the persisted
// AudioItemRecord.chunkRanges field and the dialog's summary bar need.
export function mergeChunkRanges(ranges: ChunkIndexRange[]): ChunkIndexRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.fromChunkIndex - b.fromChunkIndex);
  const merged: ChunkIndexRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const next = sorted[i]!;
    if (next.fromChunkIndex <= last.toChunkIndex + 1) {
      last.toChunkIndex = Math.max(last.toChunkIndex, next.toChunkIndex);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

// The part(s) of `target` not already covered by `covering` — the "new"
// segment of the summary bar, and the gate for "whole selection already
// saved, disable the button".
export function subtractChunkRanges(target: ChunkIndexRange, covering: ChunkIndexRange[]): ChunkIndexRange[] {
  const relevant = mergeChunkRanges(covering).filter((r) => r.toChunkIndex >= target.fromChunkIndex && r.fromChunkIndex <= target.toChunkIndex);
  const result: ChunkIndexRange[] = [];
  let cursor = target.fromChunkIndex;
  for (const r of relevant) {
    if (r.fromChunkIndex > cursor) {
      result.push({ fromChunkIndex: cursor, toChunkIndex: Math.min(r.fromChunkIndex - 1, target.toChunkIndex) });
    }
    cursor = Math.max(cursor, r.toChunkIndex + 1);
    if (cursor > target.toChunkIndex) return result;
  }
  result.push({ fromChunkIndex: cursor, toChunkIndex: target.toChunkIndex });
  return result;
}

function paragraphContaining(paragraphs: ParagraphRef[], charOffset: number): ParagraphRef {
  let found = paragraphs[0]!;
  for (const p of paragraphs) {
    if (p.charStart <= charOffset) found = p;
    else break;
  }
  return found;
}

// Pages mode's "starts and ends on whole paragraphs" requirement — expands
// (never shrinks) a char range outward to the paragraphs it touches, so
// downloaded audio never cuts mid-sentence. charEnd is treated as exclusive
// (matches PageRef.charEnd), so a range ending exactly on a paragraph
// boundary doesn't pull in the next paragraph.
export function snapCharRangeToParagraphs(paragraphs: ParagraphRef[], charStart: number, charEnd: number): CharRange {
  if (paragraphs.length === 0) return { charStart, charEnd };
  const startParagraph = paragraphContaining(paragraphs, charStart);
  const endParagraph = paragraphContaining(paragraphs, Math.max(charStart, charEnd - 1));
  return { charStart: startParagraph.charStart, charEnd: endParagraph.charEnd };
}
