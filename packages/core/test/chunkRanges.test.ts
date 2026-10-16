import { describe, expect, it } from 'vitest';
import {
  chunkCharRanges,
  chunkRangeForCharOffsets,
  mergeChunkRanges,
  snapCharRangeToParagraphs,
  subtractChunkRanges,
} from '../src/playback/chunkRanges';
import { buildChunkSequence } from '../src/playback/chunking';
import { segmentText } from '../src/segmentation/segmentText';

const SIX_SENTENCE_TEXT = 'Alpha one. Beta two. Gamma three. Delta four. Echo five. Foxtrot six.';

describe('chunkCharRanges / chunkRangeForCharOffsets', () => {
  it('maps each chunk to the char range of its first/last sentence, covering the whole document with no gaps', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, 20); // small target -> many chunks
    const ranges = chunkCharRanges(chunks, structure);

    expect(ranges[0]!.charStart).toBe(0);
    expect(ranges.at(-1)!.charEnd).toBe(SIX_SENTENCE_TEXT.length);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.charStart).toBe(ranges[i - 1]!.charEnd);
    }
  });

  it('finds the inclusive chunk-index span overlapping a char range', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, 20);
    const ranges = chunkCharRanges(chunks, structure);

    expect(ranges.length).toBeGreaterThan(2);
    // Middle of chunk 1 through middle of the last chunk.
    const midOfChunk1 = Math.floor((ranges[1]!.charStart + ranges[1]!.charEnd) / 2);
    const lastIndex = ranges.length - 1;
    const midOfLastChunk = Math.floor((ranges[lastIndex]!.charStart + ranges[lastIndex]!.charEnd) / 2);
    const result = chunkRangeForCharOffsets(ranges, midOfChunk1, midOfLastChunk);

    expect(result).toEqual({ fromChunkIndex: 1, toChunkIndex: lastIndex });
  });

  it('returns null when the range is past every chunk', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, 900);
    const ranges = chunkCharRanges(chunks, structure);

    expect(chunkRangeForCharOffsets(ranges, 10_000, 10_001)).toBeNull();
  });
});

describe('mergeChunkRanges', () => {
  it('coalesces overlapping and touching ranges, leaves disjoint ones separate', () => {
    const merged = mergeChunkRanges([
      { fromChunkIndex: 0, toChunkIndex: 2 },
      { fromChunkIndex: 3, toChunkIndex: 4 }, // touches the first (3 === 2+1)
      { fromChunkIndex: 10, toChunkIndex: 12 },
      { fromChunkIndex: 11, toChunkIndex: 15 }, // overlaps the third
    ]);

    expect(merged).toEqual([
      { fromChunkIndex: 0, toChunkIndex: 4 },
      { fromChunkIndex: 10, toChunkIndex: 15 },
    ]);
  });

  it('returns an empty array for no input', () => {
    expect(mergeChunkRanges([])).toEqual([]);
  });
});

describe('subtractChunkRanges', () => {
  it('returns the whole target when nothing covers it', () => {
    expect(subtractChunkRanges({ fromChunkIndex: 5, toChunkIndex: 10 }, [])).toEqual([{ fromChunkIndex: 5, toChunkIndex: 10 }]);
  });

  it('returns nothing when the target is fully covered', () => {
    expect(subtractChunkRanges({ fromChunkIndex: 5, toChunkIndex: 10 }, [{ fromChunkIndex: 0, toChunkIndex: 20 }])).toEqual([]);
  });

  it('returns only the uncovered portion for a partial overlap at the start', () => {
    expect(subtractChunkRanges({ fromChunkIndex: 5, toChunkIndex: 10 }, [{ fromChunkIndex: 0, toChunkIndex: 7 }])).toEqual([
      { fromChunkIndex: 8, toChunkIndex: 10 },
    ]);
  });

  it('splits the target around a covering range in the middle', () => {
    expect(subtractChunkRanges({ fromChunkIndex: 0, toChunkIndex: 10 }, [{ fromChunkIndex: 4, toChunkIndex: 6 }])).toEqual([
      { fromChunkIndex: 0, toChunkIndex: 3 },
      { fromChunkIndex: 7, toChunkIndex: 10 },
    ]);
  });
});

describe('snapCharRangeToParagraphs', () => {
  it('expands a range to the full paragraphs it touches, never shrinking it', () => {
    const text = 'Para one sentence one. Para one sentence two.\n\nPara two sentence one.\n\nPara three sentence one.';
    const structure = segmentText(text);
    expect(structure.paragraphs.length).toBe(3);
    const [p0, p1, p2] = structure.paragraphs as [typeof structure.paragraphs[0], typeof structure.paragraphs[0], typeof structure.paragraphs[0]];

    // A range starting mid-way into paragraph 0 and ending mid-way into paragraph 1.
    const snapped = snapCharRangeToParagraphs(structure.paragraphs, p0.charStart + 5, p1.charStart + 5);

    expect(snapped).toEqual({ charStart: p0.charStart, charEnd: p1.charEnd });
    expect(snapped.charEnd).toBeLessThan(p2.charStart);
  });

  it('a range ending exactly on a paragraph boundary does not pull in the next paragraph', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    const structure = segmentText(text);
    const [p0, p1] = structure.paragraphs;

    const snapped = snapCharRangeToParagraphs(structure.paragraphs, p0!.charStart, p0!.charEnd);

    expect(snapped).toEqual({ charStart: p0!.charStart, charEnd: p0!.charEnd });
    expect(snapped.charEnd).toBeLessThanOrEqual(p1!.charStart);
  });
});
