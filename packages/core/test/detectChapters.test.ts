import { describe, expect, it } from 'vitest';
import { detectChapters } from '../src/segmentation/detectChapters';

describe('detectChapters', () => {
  it('returns an empty array for text with no headers', () => {
    const text = 'Once upon a time there was a small village near the sea.\n\nIt had no chapters at all.';
    expect(detectChapters(text)).toEqual([]);
  });

  it('finds numbered "Chapter N" headers on their own line', () => {
    const text = [
      'Chapter 1',
      '',
      'It was a dark and stormy night.',
      '',
      'Chapter 2',
      '',
      'The next morning was brighter.',
    ].join('\n');

    const chapters = detectChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(text.slice(chapters[0]!.charStart, chapters[0]!.charStart + 'Chapter 1'.length)).toBe('Chapter 1');
    expect(text.slice(chapters[1]!.charStart, chapters[1]!.charStart + 'Chapter 2'.length)).toBe('Chapter 2');
  });

  it('finds ALL-CAPS headers and titled chapters with roman numerals', () => {
    const text = ['CHAPTER ONE', '', 'Some text.', '', 'Part III: The Reckoning', '', 'More text.'].join('\n');
    const chapters = detectChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['CHAPTER ONE', 'Part III: The Reckoning']);
  });

  it('does not match "chapter" mentioned in ordinary lowercase prose', () => {
    const text = 'She finally finished writing the chapter 5 excerpt before dinner.\nIt had taken her weeks.';
    expect(detectChapters(text)).toEqual([]);
  });

  it('does not match a long sentence that happens to start with a chapter-like token', () => {
    const text =
      'Chapter and verse, she could recite every rule of the game by heart, having practiced for years on end.';
    expect(detectChapters(text)).toEqual([]);
  });
});
