import { describe, expect, it } from 'vitest';
import { computeProgress, findWordAtOrBeforeOffset, findWordIndexAtOrAfterOffset } from '../src/playback/cursorMath';
import { segmentText } from '../src/segmentation/segmentText';

describe('cursorMath', () => {
  const structure = segmentText('One two three. Four five six seven.');
  const { words } = structure;

  describe('findWordAtOrBeforeOffset', () => {
    it('resolves an offset exactly at a word start', () => {
      const target = words[2]; // "three"
      if (!target) throw new Error('expected a word');
      expect(findWordAtOrBeforeOffset(words, target.charStart)?.text).toBe('three');
    });

    it('resolves an offset in the middle of a word to that word, not the next one', () => {
      const target = words[2];
      if (!target) throw new Error('expected a word');
      const midOffset = target.charStart + 1;
      expect(findWordAtOrBeforeOffset(words, midOffset)?.text).toBe('three');
    });

    it('falls back to the first word for an offset before any word', () => {
      expect(findWordAtOrBeforeOffset(words, -5)?.index).toBe(0);
    });
  });

  describe('findWordIndexAtOrAfterOffset', () => {
    it('finds the word at offset 0', () => {
      expect(findWordIndexAtOrAfterOffset(words, 0)).toBe(0);
    });

    it('finds a word roughly in the middle of the document', () => {
      const lastWord = words.at(-1);
      if (!lastWord) throw new Error('expected words');
      const midIndex = findWordIndexAtOrAfterOffset(words, Math.floor(lastWord.charEnd / 2));
      expect(midIndex).not.toBeNull();
      expect(midIndex).toBeGreaterThanOrEqual(0);
      expect(midIndex).toBeLessThan(words.length);
    });

    it('returns the last word for an offset beyond the document end', () => {
      const lastWord = words.at(-1);
      if (!lastWord) throw new Error('expected words');
      expect(findWordIndexAtOrAfterOffset(words, lastWord.charEnd + 1000)).toBe(lastWord.index);
    });

    it('returns null for an empty word list', () => {
      expect(findWordIndexAtOrAfterOffset([], 10)).toBeNull();
    });
  });

  describe('computeProgress', () => {
    it('computes a fraction between 0 and 1', () => {
      expect(computeProgress(50, 100)).toBeCloseTo(0.5);
    });

    it('returns 0 for a zero-length document instead of NaN', () => {
      expect(computeProgress(0, 0)).toBe(0);
    });

    it('clamps to [0, 1]', () => {
      expect(computeProgress(-10, 100)).toBe(0);
      expect(computeProgress(1000, 100)).toBe(1);
    });
  });
});
