import type { DocumentStructure, PageRef, ParagraphRef, SentenceRef, WordRef } from '../model/types';

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

// Builds the full page/paragraph/sentence/word index for a document's plain
// text. `pages` lets callers (the PDF pipeline) supply real page boundaries;
// pasted text omits it and is treated as a single implicit page, which keeps
// this function's original single-page behavior unchanged for that caller.
export function segmentText(text: string, pages?: PageRef[]): DocumentStructure {
  const resolvedPages: PageRef[] =
    pages && pages.length > 0 ? pages : [{ index: 0, charStart: 0, charEnd: text.length }];
  const paragraphs: ParagraphRef[] = [];
  const sentences: SentenceRef[] = [];
  const words: WordRef[] = [];

  for (const page of resolvedPages) {
    const pageText = text.slice(page.charStart, page.charEnd);
    if (pageText.length === 0) continue;

    for (const [pStart, pEnd] of splitParagraphRanges(pageText)) {
      const paragraphIndex = paragraphs.length;
      const globalPStart = page.charStart + pStart;
      const globalPEnd = page.charStart + pEnd;
      paragraphs.push({ index: paragraphIndex, pageIndex: page.index, charStart: globalPStart, charEnd: globalPEnd });

      const paragraphText = text.slice(globalPStart, globalPEnd);
      for (const seg of sentenceSegmenter.segment(paragraphText)) {
        if (seg.segment.trim().length === 0) continue;

        const sStart = globalPStart + seg.index;
        const sEnd = sStart + seg.segment.length;
        const sentenceIndex = sentences.length;
        sentences.push({
          index: sentenceIndex,
          paragraphIndex,
          pageIndex: page.index,
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
            pageIndex: page.index,
            charStart: wStart,
            charEnd: wStart + wseg.segment.length,
            text: wseg.segment,
          });
        }
      }
    }
  }

  return { pages: resolvedPages, paragraphs, sentences, words };
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
