import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageRef } from '../model/types';

export interface PdfExtractionResult {
  text: string;
  pages: PageRef[];
  hasText: boolean;
}

// Duck-typed against pdf.js's TextItem (as opposed to TextMarkedContent, which
// has a different shape) — avoids depending on pdfjs-dist's internal type
// export paths, which vary across versions.
interface PdfTextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  height: number;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === 'object' && item !== null && 'str' in item;
}

// Reconstructs a page's text from pdf.js's flat text-item list. `hasEOL` marks
// a line break; a larger-than-normal vertical jump between lines is treated as
// a paragraph break. This is a heuristic — pdf.js does not expose paragraph
// structure directly — but it's enough to keep multi-line text readable and
// to let the existing blank-line paragraph splitter in segmentText work
// unchanged for PDF-derived text, same as it does for pasted text.
function buildPageText(items: PdfTextItem[]): string {
  let result = '';
  let prevY: number | null = null;
  let prevHeight: number | null = null;
  let atLineStart = true;

  for (const item of items) {
    const y = item.transform[5] ?? 0;

    if (!atLineStart) {
      result += ' ';
    } else if (result.length > 0) {
      const lineHeight = prevHeight ?? item.height ?? 12;
      const gap = prevY === null ? 0 : Math.abs(prevY - y);
      result += gap > lineHeight * 1.6 ? '\n\n' : '\n';
    }

    result += item.str;
    prevY = y;
    prevHeight = item.height || prevHeight;
    atLineStart = item.hasEOL;
  }

  return result;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfExtractionResult> {
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  let text = '';
  const pages: PageRef[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems: PdfTextItem[] = [];
      for (const item of content.items) {
        if (isTextItem(item)) textItems.push(item);
      }
      const pageText = buildPageText(textItems);

      const charStart = text.length;
      text += pageText;
      pages.push({ index: pageNumber - 1, charStart, charEnd: text.length });

      if (pageNumber < pdf.numPages) {
        text += '\n\n';
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  const hasText = text.replace(/\s/g, '').length > 0;
  return { text, pages, hasText };
}
