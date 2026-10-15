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

  it('mode "off" returns no chapters even when "Chapter N" headers are present', () => {
    const text = ['Chapter 1', '', 'It was a dark and stormy night.'].join('\n');
    expect(detectChapters(text, { mode: 'off', customPrefix: '' })).toEqual([]);
  });

  it('mode "custom" with a prefix matches that word instead of "Chapter"/"Part"', () => {
    const text = ['Section 1', '', 'First part.', '', 'Section 2', '', 'Second part.'].join('\n');
    const chapters = detectChapters(text, { mode: 'custom', customPrefix: 'Section' });
    expect(chapters.map((c) => c.title)).toEqual(['Section 1', 'Section 2']);
  });

  it('mode "custom" with no prefix matches a bare leading number (e.g. translated web-novel style)', () => {
    const text = ['301 The Excited Ji Mo', '', 'Some text.', '', '302 Another Title', '', 'More text.'].join('\n');
    const chapters = detectChapters(text, { mode: 'custom', customPrefix: '' });
    expect(chapters.map((c) => c.title)).toEqual(['301 The Excited Ji Mo', '302 Another Title']);
  });

  it('mode "custom" with no prefix does not match ordinary prose that starts with a word, not a number', () => {
    const text = 'The Excited Ji Mo walked into the room and said nothing at all.';
    expect(detectChapters(text, { mode: 'custom', customPrefix: '' })).toEqual([]);
  });
});
