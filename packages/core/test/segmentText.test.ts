import { describe, expect, it } from 'vitest';
import { segmentText } from '../src/segmentation/segmentText';

describe('segmentText', () => {
  it('produces a single page spanning the whole text', () => {
    const text = 'Hello world. Goodbye world.';
    const structure = segmentText(text);
    expect(structure.pages).toEqual([{ index: 0, charStart: 0, charEnd: text.length }]);
  });

  it('splits paragraphs on blank lines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    const structure = segmentText(text);
    expect(structure.paragraphs).toHaveLength(2);
  });

  it('splits sentences within a paragraph', () => {
    const structure = segmentText('One. Two. Three.');
    expect(structure.sentences).toHaveLength(3);
    expect(structure.sentences.map((s) => s.text.trim())).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('splits words and excludes punctuation/whitespace segments', () => {
    const structure = segmentText('Hello, world!');
    expect(structure.words.map((w) => w.text)).toEqual(['Hello', 'world']);
  });

  it('produces global character offsets that round-trip back to the source text', () => {
    const text = 'Hello world. Another sentence here.';
    const structure = segmentText(text);
    for (const word of structure.words) {
      expect(text.slice(word.charStart, word.charEnd)).toBe(word.text);
    }
    for (const sentence of structure.sentences) {
      expect(text.slice(sentence.charStart, sentence.charEnd)).toBe(sentence.text);
    }
  });

  it('returns empty structure arrays for empty text', () => {
    const structure = segmentText('');
    expect(structure.pages).toEqual([{ index: 0, charStart: 0, charEnd: 0 }]);
    expect(structure.paragraphs).toHaveLength(0);
    expect(structure.sentences).toHaveLength(0);
    expect(structure.words).toHaveLength(0);
  });

  it('handles long text with consistent offsets throughout', () => {
    const longText = Array.from({ length: 2000 }, (_, i) => `Word${i} appears in sentence ${i} here.`).join(
      ' ',
    );
    const structure = segmentText(longText);
    expect(structure.sentences.length).toBe(2000);
    for (const word of structure.words) {
      expect(longText.slice(word.charStart, word.charEnd)).toBe(word.text);
    }
  });
});
