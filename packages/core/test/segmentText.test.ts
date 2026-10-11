import { describe, expect, it } from 'vitest';
import { normalizeLineWraps, segmentText } from '../src/segmentation/segmentText';

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

  it('normalizeLineWraps collapses a lone line-wrap \\n to a space but leaves \\n{2,} paragraph breaks untouched', () => {
    expect(normalizeLineWraps('wrapped\nline')).toBe('wrapped line');
    expect(normalizeLineWraps('para one\n\npara two')).toBe('para one\n\npara two');
    expect(normalizeLineWraps('a\nb\n\nc\nd')).toBe('a b\n\nc d');
  });

  it('normalizeLineWraps is length-preserving (every other char keeps its exact position)', () => {
    const text = 'line one\nline two\n\nnext paragraph';
    expect(normalizeLineWraps(text)).toHaveLength(text.length);
  });

  // Regression: pdf.js/pdftotext emit one bare \n per *visual* PDF line, not
  // per paragraph (see extractPdf.ts's buildPageText and ARCHITECTURE.md's
  // TTS chunking note). Intl.Segmenter's sentence-boundary rules (UAX #29
  // SB4) treat any \n as an unconditional sentence break regardless of
  // punctuation — left unnormalized, a single prose sentence wrapped across
  // three visual PDF lines would fragment into three separate "sentences",
  // each becoming its own audible-gap TTS utterance one layer up in
  // PlaybackController.
  it('does not fracture a sentence into multiple sentences at a bare PDF line-wrap \\n', () => {
    const wrappedPdfText = 'This sentence wraps\nacross three\nvisual PDF lines before it ends.';
    const structure = segmentText(wrappedPdfText);
    expect(structure.sentences).toHaveLength(1);
    expect(structure.sentences[0]?.text).toBe('This sentence wraps across three visual PDF lines before it ends.');
  });

  it('still splits into separate sentences at a real paragraph break (\\n{2,}), even without punctuation', () => {
    const text = 'First paragraph wraps\nacross two lines\n\nSecond paragraph starts here';
    const structure = segmentText(text);
    expect(structure.paragraphs).toHaveLength(2);
    expect(structure.sentences.map((s) => s.text)).toEqual([
      'First paragraph wraps across two lines',
      'Second paragraph starts here',
    ]);
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
