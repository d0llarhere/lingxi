import { detectChapters, findPageIndexAtOffset, type ChapterDetectionSettings } from '@lingxi/core';
import { useEffect, useState } from 'react';
import { findChapterAt } from './DocumentRow';
import { useLibrary } from './LibraryProvider';

export interface ApproxBookPosition {
  chapterNumber: number;
  chapterTitle: string;
  pageIndex: number;
  totalPages: number;
}

// Approximates "where in the book" a book-derived AudioItemRecord's current
// playback position corresponds to, from the position/duration ratio against
// the document's total character count — the same linear chars-per-second
// estimate DocumentRow.formatLength already relies on, rather than
// persisting a per-chunk time→offset timeline just for this display. Shared
// by DownloadRow (list row) and AudioPill (in-page player).
export function useApproxBookPosition(
  documentId: string | null,
  positionMs: number,
  durationMs: number,
  chapterDetection: ChapterDetectionSettings,
): ApproxBookPosition | null {
  const { repository } = useLibrary();
  const [result, setResult] = useState<ApproxBookPosition | null>(null);

  useEffect(() => {
    if (!documentId || positionMs <= 0 || durationMs <= 0 || !repository || chapterDetection.mode === 'off') {
      setResult(null);
      return;
    }
    let cancelled = false;
    Promise.all([repository.getDocument(documentId), repository.getDocumentText(documentId)]).then(([doc, text]) => {
      if (cancelled || !doc || !text) return;
      const approxCharOffset = Math.round((positionMs / durationMs) * text.length);
      const chapter = findChapterAt(detectChapters(text, chapterDetection), approxCharOffset);
      if (!chapter) {
        setResult(null);
        return;
      }
      setResult({
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        pageIndex: findPageIndexAtOffset(doc.structure.pages, approxCharOffset),
        totalPages: doc.structure.pages.length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repository, documentId, positionMs, durationMs, chapterDetection]);

  return result;
}
