import type { ParagraphRef, WordRef } from '@lingxi/core';
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';

interface WordTextProps {
  text: string;
  words: WordRef[];
  paragraphs: ParagraphRef[];
  initialHighlightWordIndex: number | null;
  onWordClick: (wordIndex: number) => void;
  // Reports the paragraph nearest the top of the viewport as the user
  // scrolls — used when the reader isn't playing, so the header/pill can
  // show what's actually on screen instead of a frozen playback position
  // (see ReaderScreen's displayCharOffset).
  onVisibleParagraphChange?: (paragraphIndex: number) => void;
  // Reading settings' "Auto-scroll to follow the voice" — when false, the
  // active word/sentence still highlights but the viewport never moves.
  autoScrollEnabled: boolean;
}

// How long a hand scroll (wheel/touch) suppresses auto-scroll-to-follow —
// brief: "Pauses for a few seconds when you scroll yourself".
const AUTO_SCROLL_SUPPRESS_MS = 5000;
// Long enough to cover the scrollIntoView({behavior:'smooth'}) animation
// this component triggers itself, so that scroll is never mistaken for a
// user-initiated one by the wheel/touchmove listener below.
const PROGRAMMATIC_SCROLL_GUARD_MS = 1000;

export interface WordTextHandle {
  setActiveWord: (wordIndex: number | null) => void;
  // Tints the whole sentence containing the word currently being spoken
  // (lingxi-redesign/REDESIGN_BRIEF.md's pill player spec) — same
  // imperative-class approach as setActiveWord, driven by
  // ReadingCursor.sentenceIndex (already tracked, no new data needed).
  setActiveSentence: (sentenceIndex: number | null) => void;
  // Search highlighting — same imperative DOM-class approach as
  // setActiveWord (see the perf note above), not React state: a document
  // with hundreds of thousands of words can't re-render on every keystroke.
  setSearchMatches: (wordIndices: Set<number>) => void;
  setActiveMatch: (wordIndex: number | null) => void;
}

interface Segment {
  key: string;
  isWord: boolean;
  content: string;
  wordIndex: number;
}

interface Sentence {
  key: string;
  sentenceIndex: number;
  segments: Segment[];
}

interface Paragraph {
  key: string;
  // ParagraphRef.index — not the position in this rendered array, which
  // skips any paragraph with no words (see the build loop below). Needed to
  // report "the visible paragraph" back to the caller by its real index.
  index: number;
  sentences: Sentence[];
}

// Reconstructs the exact original text (whitespace/punctuation included) as a
// sequence of spans, so only real "words" (per segmentText's WordRef list)
// are clickable, and the currently spoken one can be highlighted.
//
// PERFORMANCE: for a real-world document this can mean hundreds of thousands
// of words. Profiling (see ARCHITECTURE.md notes) showed that re-rendering
// this component's word list on every highlight change — even memoized —
// cost 500ms-2000ms of main-thread blocking on a 184k-word document, because
// React still has to recreate every element and reconcile the whole tree.
// The fix: `highlightWordIndex` is NOT a prop that re-renders this component.
// The word spans are rendered ONCE (keyed only to `text`/`words`), and the
// currently-active word is updated via direct DOM mutation (classList +
// scrollIntoView) through an imperative handle, exposed via ref. This makes
// every highlight update an O(1) DOM operation instead of an O(n) re-render.
// Click handling uses one delegated listener on the container instead of a
// closure per word, which also removes an O(n) allocation on every render.
export const WordText = memo(
  forwardRef<WordTextHandle, WordTextProps>(function WordText(
    { text, words, paragraphs: paragraphRefs, initialHighlightWordIndex, onWordClick, onVisibleParagraphChange, autoScrollEnabled },
    ref,
  ) {
    const wordElsRef = useRef<Map<number, HTMLSpanElement>>(new Map());
    const sentenceElsRef = useRef<Map<number, HTMLSpanElement>>(new Map());
    const paragraphElsRef = useRef<Map<number, HTMLParagraphElement>>(new Map());
    const activeSentenceIndexRef = useRef<number | null>(null);
    const activeIndexRef = useRef<number | null>(null);
    const searchMatchIndicesRef = useRef<Set<number>>(new Set());
    // Read inside the IntersectionObserver callback below, which is created
    // lazily once and must not close over a stale prop value.
    const autoScrollEnabledRef = useRef(autoScrollEnabled);
    useEffect(() => {
      autoScrollEnabledRef.current = autoScrollEnabled;
    }, [autoScrollEnabled]);
    // Timestamp until which auto-scroll is suppressed (brief: "Pauses for a
    // few seconds when you scroll yourself"), and a guard so the hand-scroll
    // listener below doesn't mistake our own scrollIntoView call for one.
    const scrollSuppressedUntilRef = useRef(0);
    const programmaticScrollRef = useRef(false);

    useEffect(() => {
      function handleUserScroll() {
        if (programmaticScrollRef.current) return;
        scrollSuppressedUntilRef.current = Date.now() + AUTO_SCROLL_SUPPRESS_MS;
      }
      window.addEventListener('wheel', handleUserScroll, { passive: true });
      window.addEventListener('touchmove', handleUserScroll, { passive: true });
      return () => {
        window.removeEventListener('wheel', handleUserScroll);
        window.removeEventListener('touchmove', handleUserScroll);
      };
    }, []);
    const activeMatchIndexRef = useRef<number | null>(null);
    // Lazily-created; only needed once playback actually starts scrolling.
    const visibilityObserverRef = useRef<IntersectionObserver | null>(null);

    // Grouped by paragraph, then by sentence within it (not one flat span
    // list) so each paragraph can be its own `content-visibility: auto`
    // block — see the perf note below — and so the currently-spoken
    // sentence can be tinted as one wrapping element (brief:
    // --highlight-sentence + box-decoration-break: clone so wrapped lines
    // tint correctly). Uses each ParagraphRef's own charStart/charEnd as the
    // authoritative bounds (not word-transition inference — an earlier
    // version of this inferred paragraph boundaries from where
    // word.paragraphIndex changed, which silently dropped each paragraph's
    // trailing punctuation, since that punctuation sits in the "gap" after
    // the last word but was never attributed to the paragraph that was just
    // closed out). The same gap-trails-the-preceding-word convention applies
    // at the sentence level below.
    const paragraphs = useMemo<Paragraph[]>(() => {
      const wordsByParagraph = new Map<number, WordRef[]>();
      for (const word of words) {
        let bucket = wordsByParagraph.get(word.paragraphIndex);
        if (!bucket) {
          bucket = [];
          wordsByParagraph.set(word.paragraphIndex, bucket);
        }
        bucket.push(word);
      }

      const result: Paragraph[] = [];
      for (const paragraphRef of paragraphRefs) {
        const paragraphWords = wordsByParagraph.get(paragraphRef.index);
        if (!paragraphWords || paragraphWords.length === 0) continue;

        const sentences: Sentence[] = [];
        let segments: Segment[] = [];
        let cursor = paragraphRef.charStart;
        let currentSentenceIndex = paragraphWords[0]!.sentenceIndex;

        const flushSentence = (end: number) => {
          if (segments.length === 0) return;
          sentences.push({ key: `s-${currentSentenceIndex}`, sentenceIndex: currentSentenceIndex, segments });
          segments = [];
          void end;
        };

        for (const word of paragraphWords) {
          if (word.sentenceIndex !== currentSentenceIndex) {
            flushSentence(cursor);
            currentSentenceIndex = word.sentenceIndex;
          }
          if (word.charStart > cursor) {
            segments.push({ key: `gap-${word.index}`, isWord: false, content: text.slice(cursor, word.charStart), wordIndex: -1 });
          }
          segments.push({
            key: `word-${word.index}`,
            isWord: true,
            content: text.slice(word.charStart, word.charEnd),
            wordIndex: word.index,
          });
          cursor = word.charEnd;
        }
        if (cursor < paragraphRef.charEnd) {
          segments.push({ key: `gap-end-${paragraphRef.index}`, isWord: false, content: text.slice(cursor, paragraphRef.charEnd), wordIndex: -1 });
        }
        flushSentence(paragraphRef.charEnd);

        result.push({ key: `p-${paragraphRef.index}`, index: paragraphRef.index, sentences });
      }

      return result;
    }, [text, words, paragraphRefs]);

    // Tracks which paragraph is nearest the top of the viewport as the user
    // scrolls — used by the caller (ReaderScreen) to show what's actually on
    // screen while not playing, instead of a frozen playback position (see
    // bug: header/pill showed a stale chapter after opening a document
    // scrolled to the top while the persisted cursor was deep inside it).
    // An IntersectionObserver, not a scroll-listener + getBoundingClientRect
    // — the latter forces synchronous layout on every scroll tick, which
    // defeats `content-visibility: auto` on this file's own terms (see the
    // perf note above); IntersectionObserver reports visibility
    // asynchronously off the render path and composes correctly with
    // content-visibility instead of forcing it to resolve early.
    useEffect(() => {
      if (!onVisibleParagraphChange) return;
      const visible = new Set<number>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.paragraphIndex);
            if (Number.isNaN(idx)) continue;
            if (entry.isIntersecting) visible.add(idx);
            else visible.delete(idx);
          }
          if (visible.size === 0) return;
          onVisibleParagraphChange(Math.min(...visible));
        },
        // Only the top ~30% of the viewport counts as "the top" — roughly
        // matches the active-paragraph scroll target used elsewhere
        // (brief: "about 1/3 from the top").
        { rootMargin: '0px 0px -70% 0px', threshold: 0 },
      );
      for (const el of paragraphElsRef.current.values()) observer.observe(el);
      return () => observer.disconnect();
    }, [paragraphs, onVisibleParagraphChange]);

    const setActiveWord = (wordIndex: number | null, scroll: boolean) => {
      const prevIndex = activeIndexRef.current;
      if (prevIndex !== null) {
        wordElsRef.current.get(prevIndex)?.classList.remove('is-active');
      }
      if (wordIndex !== null) {
        const el = wordElsRef.current.get(wordIndex);
        if (el) {
          el.classList.add('is-active');
          if (scroll) {
            // getBoundingClientRect() forces a synchronous layout flush.
            // Measured cost on a document with tens of thousands of words in
            // one unbroken flow: 50-180ms *per highlight tick*, even though
            // the highlight itself no longer touches layout — just walking
            // the invalidation state on a huge flat DOM is expensive when
            // forced synchronously. IntersectionObserver reports visibility
            // asynchronously off the main render path, so checking it never
            // blocks the highlight update itself; scrolling still only
            // happens when the word actually isn't comfortably visible.
            if (!visibilityObserverRef.current) {
              visibilityObserverRef.current = new IntersectionObserver(
                (entries) => {
                  if (!autoScrollEnabledRef.current || Date.now() < scrollSuppressedUntilRef.current) return;
                  for (const entry of entries) {
                    if (!entry.isIntersecting) {
                      programmaticScrollRef.current = true;
                      entry.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setTimeout(() => {
                        programmaticScrollRef.current = false;
                      }, PROGRAMMATIC_SCROLL_GUARD_MS);
                    }
                  }
                },
                { rootMargin: '-20% 0px -20% 0px', threshold: 0 },
              );
            }
            // disconnect() drops the previous target and cancels any of its
            // pending notifications, so a stale word can never trigger a
            // scroll after the active word has already moved on.
            visibilityObserverRef.current.disconnect();
            visibilityObserverRef.current.observe(el);
          }
        }
      }
      activeIndexRef.current = wordIndex;
    };

    const setActiveSentence = (sentenceIndex: number | null) => {
      const prevIndex = activeSentenceIndexRef.current;
      if (prevIndex !== null) {
        sentenceElsRef.current.get(prevIndex)?.classList.remove('is-active-sentence');
      }
      if (sentenceIndex !== null) {
        sentenceElsRef.current.get(sentenceIndex)?.classList.add('is-active-sentence');
      }
      activeSentenceIndexRef.current = sentenceIndex;
    };

    const setSearchMatches = (wordIndices: Set<number>) => {
      for (const prevIndex of searchMatchIndicesRef.current) {
        if (!wordIndices.has(prevIndex)) wordElsRef.current.get(prevIndex)?.classList.remove('is-search-match');
      }
      for (const index of wordIndices) {
        wordElsRef.current.get(index)?.classList.add('is-search-match');
      }
      searchMatchIndicesRef.current = wordIndices;
    };

    const setActiveMatch = (wordIndex: number | null) => {
      const prevIndex = activeMatchIndexRef.current;
      if (prevIndex !== null) wordElsRef.current.get(prevIndex)?.classList.remove('is-active-match');
      if (wordIndex !== null) wordElsRef.current.get(wordIndex)?.classList.add('is-active-match');
      activeMatchIndexRef.current = wordIndex;
    };

    useImperativeHandle(ref, () => ({
      setActiveWord: (wordIndex) => setActiveWord(wordIndex, true),
      setActiveSentence,
      setSearchMatches,
      setActiveMatch,
    }));

    useEffect(() => {
      return () => visibilityObserverRef.current?.disconnect();
    }, []);

    // Applies the persisted cursor's word as soon as the word elements exist
    // for a (re)opened document — before any playback tick has occurred —
    // without scrolling (the reader should open at the top, not jump).
    useEffect(() => {
      activeIndexRef.current = null;
      activeSentenceIndexRef.current = null;
      setActiveWord(initialHighlightWordIndex, false);
      const word = initialHighlightWordIndex !== null ? words[initialHighlightWordIndex] : undefined;
      setActiveSentence(word?.sentenceIndex ?? null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, words]);

    function findWordIndex(target: EventTarget | null): number | null {
      const el = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-word-index]') : null;
      if (!el) return null;
      const idx = Number(el.dataset.wordIndex);
      return Number.isNaN(idx) ? null : idx;
    }

    function handleClick(e: MouseEvent<HTMLDivElement>) {
      const idx = findWordIndex(e.target);
      if (idx !== null) onWordClick(idx);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const idx = findWordIndex(e.target);
      if (idx !== null) {
        e.preventDefault();
        onWordClick(idx);
      }
    }

    return (
      <div className="reading-column" onClick={handleClick} onKeyDown={handleKeyDown}>
        {paragraphs.map((paragraph) => (
          <p
            key={paragraph.key}
            className="reading-paragraph"
            data-paragraph-index={paragraph.index}
            ref={(el) => {
              if (el) paragraphElsRef.current.set(paragraph.index, el);
              else paragraphElsRef.current.delete(paragraph.index);
            }}
          >
            {paragraph.sentences.map((sentence) => (
              <span
                key={sentence.key}
                ref={(el) => {
                  if (el) sentenceElsRef.current.set(sentence.sentenceIndex, el);
                  else sentenceElsRef.current.delete(sentence.sentenceIndex);
                }}
                data-sentence-index={sentence.sentenceIndex}
                className="reading-sentence"
              >
                {sentence.segments.map((segment) =>
                  segment.isWord ? (
                    <span
                      key={segment.key}
                      ref={(el) => {
                        if (el) wordElsRef.current.set(segment.wordIndex, el);
                        else wordElsRef.current.delete(segment.wordIndex);
                      }}
                      role="button"
                      tabIndex={0}
                      data-word-index={segment.wordIndex}
                      className="reading-word"
                    >
                      {segment.content}
                    </span>
                  ) : (
                    <span key={segment.key}>{segment.content}</span>
                  ),
                )}
              </span>
            ))}
          </p>
        ))}
      </div>
    );
  }),
);
