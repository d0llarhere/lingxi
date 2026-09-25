import type { DocumentStructure, PageRef, ParagraphRef, SentenceRef, WordRef } from '../model/types';

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

// Builds the full page/paragraph/sentence/word index for a plain-text document.
// Pasted text is treated as a single page; the same structure shape is reused
// by the PDF pipeline later, which will populate multiple PageRefs instead.
export function segmentText(text: string): DocumentStructure {
  const page: PageRef = { index: 0, charStart: 0, charEnd: text.length };
  const paragraphs: ParagraphRef[] = [];
  const sentences: SentenceRef[] = [];
  const words: WordRef[] = [];

  if (text.length === 0) {
    return { pages: [page], paragraphs, sentences, words };
  }

  for (const [pStart, pEnd] of splitParagraphRanges(text)) {
    const paragraphIndex = paragraphs.length;
    paragraphs.push({ index: paragraphIndex, pageIndex: 0, charStart: pStart, charEnd: pEnd });

    const paragraphText = text.slice(pStart, pEnd);
    for (const seg of sentenceSegmenter.segment(paragraphText)) {
      if (seg.segment.trim().length === 0) continue;

      const sStart = pStart + seg.index;
      const sEnd = sStart + seg.segment.length;
      const sentenceIndex = sentences.length;
      sentences.push({
        index: sentenceIndex,
        paragraphIndex,
        pageIndex: 0,
        charStart: sStart,
        charEnd: sEnd,
        text: seg.segment,
      });

      for (const wseg of wordSegmenter.segment(seg.segment)) {
        if (!wseg.isWordLike) continue;
        const wStart = sStart + wseg.index;
        words.push({
          index: words.length,
          sentenceIndex,
          paragraphIndex,
          pageIndex: 0,
          charStart: wStart,
          charEnd: wStart + wseg.segment.length,
          text: wseg.segment,
        });
      }
    }
  }

  return { pages: [page], paragraphs, sentences, words };
}

function splitParagraphRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const blankLine = /\n{2,}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = blankLine.exec(text))) {
    pushRange(ranges, cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushRange(ranges, cursor, text.length);

  return ranges.length > 0 ? ranges : [[0, text.length]];
}

function pushRange(ranges: Array<[number, number]>, start: number, end: number) {
  if (end > start) ranges.push([start, end]);
}
