import type { SentenceRef } from '../model/types';

// Listening settings' "Skip page numbers and headers" — scoped to the
// literal case the brief names ("Page 12", or a bare page number on its own
// line). Deliberately not attempting "running headers that repeat across
// pages": that needs whole-document cross-page frequency analysis, a
// meaningfully bigger and fuzzier feature than this one pattern check.
const PAGE_NUMBER_PATTERN = /^(?:page\s*)?\d+$/i;

export function shouldSkipSentenceForSpeech(sentence: SentenceRef): boolean {
  return PAGE_NUMBER_PATTERN.test(sentence.text.trim());
}
