export interface ChapterRef {
  title: string;
  charStart: number;
}

export type ChapterDetectionMode = 'auto' | 'off' | 'custom';

export interface ChapterDetectionSettings {
  mode: ChapterDetectionMode;
  // Only read when mode === 'custom'. The word a chapter heading starts
  // with in this book (e.g. "Section", "Episode"). Empty means headings
  // have no prefix word at all, just a bare number (e.g. "301 Title").
  customPrefix: string;
}

export const DEFAULT_CHAPTER_DETECTION: ChapterDetectionSettings = { mode: 'auto', customPrefix: '' };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Conservative on purpose: requires the whole line to look like a heading
// (short, starts with a capitalized token) rather than loosely matching
// "chapter" anywhere — the latter matches ordinary prose too often (e.g.
// "...in the chapter 5 excerpt she wrote..."). Real book headings are
// virtually always capitalized and short; prose mentioning a chapter
// mid-sentence is usually neither. Callers that find zero matches should
// fall back to page-level navigation (see ReaderScreen's TOC), not treat
// it as an error.
function buildPattern(settings: ChapterDetectionSettings): RegExp | null {
  if (settings.mode === 'off') return null;

  if (settings.mode === 'custom') {
    const prefix = settings.customPrefix.trim();
    if (!prefix) {
      // No prefix configured — headings are a bare number followed by a
      // title, e.g. "301 The Excited Ji Mo" (common in translated web-novel
      // PDFs). Still requires a leading number, not just "any short line",
      // so it doesn't match arbitrary prose — though a short sentence that
      // happens to start with a number ("5 dollars were left...") can still
      // false-positive; that tradeoff is why this is an opt-in mode.
      return /^[ \t]*(\d+\s+\S[^\n]{0,60})[ \t]*$/gm;
    }
    return new RegExp(`^[ \\t]*(${escapeRegExp(prefix)}\\s+(?:\\d+|[IVXLCDM]+|[A-Za-z]+)\\b[^\\n]{0,60})[ \\t]*$`, 'gm');
  }

  return /^[ \t]*((?:Chapter|CHAPTER|Part|PART)\s+(?:\d+|[IVXLCDM]+|[A-Za-z]+)\b[^\n]{0,60})[ \t]*$/gm;
}

export function detectChapters(text: string, settings: ChapterDetectionSettings = DEFAULT_CHAPTER_DETECTION): ChapterRef[] {
  const pattern = buildPattern(settings);
  if (!pattern) return [];

  const chapters: ChapterRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    chapters.push({ title: match[1]!.trim(), charStart: match.index });
  }
  return chapters;
}
