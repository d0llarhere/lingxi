import { describe, expect, it } from 'vitest';
import { buildChunkFromWord, buildChunkSequence } from '../src/playback/chunking';
import { segmentText } from '../src/segmentation/segmentText';

const SIX_SENTENCE_TEXT = 'Alpha one. Beta two. Gamma three. Delta four. Echo five. Foxtrot six.';

describe('buildChunkSequence', () => {
  it('returns an empty array for a document with no words', () => {
    expect(buildChunkSequence(segmentText(''), '')).toEqual([]);
  });

  it('groups consecutive sentences up to the target size, never splitting a sentence mid-way', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const s = structure.sentences;
    const chunkTargetChars = s[2]!.charEnd - s[0]!.charStart; // fits sentences 0-2 exactly

    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, chunkTargetChars);

    expect(chunks[0]!.firstSentenceIndex).toBe(0);
    expect(chunks[0]!.lastSentenceIndex).toBe(2);
    expect(chunks[0]!.text).toBe(SIX_SENTENCE_TEXT.slice(s[0]!.charStart, s[2]!.charEnd));
  });

  it('covers the whole document with no gaps or overlaps between consecutive chunks', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, 20); // small target -> many chunks

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.firstSentenceIndex).toBe(chunks[i - 1]!.lastSentenceIndex + 1);
    }
    expect(chunks[0]!.firstSentenceIndex).toBe(0);
    expect(chunks.at(-1)!.lastSentenceIndex).toBe(structure.sentences.length - 1);
  });

  it('a single sentence longer than the target is still a whole chunk on its own, never split', () => {
    const longText = `${'word '.repeat(50).trim()}. Short.`;
    const structure = segmentText(longText);
    const chunks = buildChunkSequence(structure, longText, 5);

    expect(chunks[0]!.firstSentenceIndex).toBe(0);
    expect(chunks[0]!.lastSentenceIndex).toBe(0);
    expect(chunks[0]!.text).toBe(longText.slice(structure.sentences[0]!.charStart, structure.sentences[0]!.charEnd));
  });

  it('with a large target, the whole document is exactly one chunk', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunks = buildChunkSequence(structure, SIX_SENTENCE_TEXT, 900);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe(SIX_SENTENCE_TEXT);
  });
});

describe('buildChunkFromWord vs buildChunkSequence (cache-key consistency)', () => {
  // The whole reason these two entry points exist as thin wrappers around a
  // shared walk: reading a document straight through from its first word
  // (never pausing mid-chunk) must produce byte-identical chunk text to the
  // canonical buildChunkSequence — otherwise CachingTTSEngine's hash-based
  // cache key diverges between live playback and offline-download/export,
  // and they silently stop sharing synthesized audio. See chunking.ts.
  it('starting buildChunkFromWord at the document\'s first word matches buildChunkSequence\'s first chunk', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunkTargetChars = structure.sentences[2]!.charEnd - structure.sentences[0]!.charStart;
    const sequence = buildChunkSequence(structure, SIX_SENTENCE_TEXT, chunkTargetChars);

    const wordsBySentence = new Map<number, (typeof structure.words)[number][]>();
    for (const word of structure.words) {
      const bucket = wordsBySentence.get(word.sentenceIndex) ?? [];
      bucket.push(word);
      wordsBySentence.set(word.sentenceIndex, bucket);
    }
    const firstWord = structure.words[0]!;
    const fromWord = buildChunkFromWord(structure, SIX_SENTENCE_TEXT, wordsBySentence, firstWord, chunkTargetChars);

    expect(fromWord.text).toBe(sequence[0]!.text);
    expect(fromWord.lastSentenceIndex).toBe(sequence[0]!.lastSentenceIndex);
  });

  it('resuming straight-through playback chunk-by-chunk reproduces the entire canonical sequence', () => {
    const structure = segmentText(SIX_SENTENCE_TEXT);
    const chunkTargetChars = 25;
    const sequence = buildChunkSequence(structure, SIX_SENTENCE_TEXT, chunkTargetChars);

    const wordsBySentence = new Map<number, (typeof structure.words)[number][]>();
    for (const word of structure.words) {
      const bucket = wordsBySentence.get(word.sentenceIndex) ?? [];
      bucket.push(word);
      wordsBySentence.set(word.sentenceIndex, bucket);
    }

    let word = structure.words[0]!;
    for (const expectedChunk of sequence) {
      const chunk = buildChunkFromWord(structure, SIX_SENTENCE_TEXT, wordsBySentence, word, chunkTargetChars);
      expect(chunk.text).toBe(expectedChunk.text);
      expect(chunk.lastSentenceIndex).toBe(expectedChunk.lastSentenceIndex);

      const nextSentenceIndex = chunk.lastSentenceIndex + 1;
      const nextWord = structure.words.find((w) => w.sentenceIndex === nextSentenceIndex);
      if (!nextWord) break;
      word = nextWord;
    }
  });
});
