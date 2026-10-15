import type { PageRef, WordRef } from '../model/types';

// Pure functions only — no TTS, no storage, no timers. Kept separate from
// PlaybackController so the offset/word-mapping math is independently
// testable without mocking anything.

// Words within a single sentence are few (typically well under a hundred),
// so a linear scan for the last word starting at-or-before a boundary offset
// is simpler than a binary search and plenty fast.
export function findWordAtOrBeforeOffset(words: WordRef[], globalOffset: number): WordRef | undefined {
  let result: WordRef | undefined;
  for (const word of words) {
    if (word.charStart <= globalOffset) {
      result = word;
    } else {
      break;
    }
  }
  return result ?? words[0];
}

// Binary search over the whole document's words (sorted by charStart, by
// construction from segmentText) — used for progress-bar seeking, where the
// word list can be large for long documents.
export function findWordIndexAtOrAfterOffset(words: WordRef[], targetOffset: number): number | null {
  if (words.length === 0) return null;

  let low = 0;
  let high = words.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midWord = words[mid];
    if (midWord && midWord.charEnd <= targetOffset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return words[low]?.index ?? null;
}

export function computeProgress(charOffset: number, totalLength: number): number {
  if (totalLength <= 0) return 0;
  return Math.min(1, Math.max(0, charOffset / totalLength));
}

// Pages are few (tens to low hundreds even for a long PDF) and sorted by
// charStart, so a linear scan is simpler than a binary search and plenty
// fast. Returns 0 for an empty page list rather than throwing — callers
// that pass an offset past the end of the document get the last page.
export function findPageIndexAtOffset(pages: PageRef[], charOffset: number): number {
  let index = 0;
  for (const page of pages) {
    if (page.charStart <= charOffset) index = page.index;
    else break;
  }
  return index;
}
