export interface ChapterRef {
  title: string;
  charStart: number;
}

// Conservative on purpose: requires the whole line to look like a heading
// (short, starts with a capitalized "Chapter"/"Part" token) rather than
// loosely matching "chapter" anywhere — the latter matches ordinary prose
// too often (e.g. "...in the chapter 5 excerpt she wrote..."). Real book
// headings are virtually always capitalized and short; prose mentioning a
// chapter mid-sentence is usually neither. Title-case or ALL-CAPS only
// (not plain lowercase) is the deciding signal here, not an exhaustive
// style list — callers that find zero matches should fall back to
// page-level navigation (see ReaderScreen's TOC), not treat it as an error.
const CHAPTER_HEADER = /^[ \t]*((?:Chapter|CHAPTER|Part|PART)\s+(?:\d+|[IVXLCDM]+|[A-Za-z]+)\b[^\n]{0,60})[ \t]*$/gm;

export function detectChapters(text: string): ChapterRef[] {
  const pattern = new RegExp(CHAPTER_HEADER.source, CHAPTER_HEADER.flags);
  const chapters: ChapterRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    chapters.push({ title: match[1]!.trim(), charStart: match.index });
  }
  return chapters;
}
