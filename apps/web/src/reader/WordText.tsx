import type { ParagraphRef, WordRef } from '@lingxi/core';
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';

interface WordTextProps {
  text: string;
  words: WordRef[];
  paragraphs: ParagraphRef[];
  initialHighlightWordIndex: number | null;
  onWordClick: (wordIndex: number) => void;
}

export interface WordTextHandle {
  setActiveWord: (wordIndex: number | null) => void;
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

interface Paragraph {
  key: string;
  segments: Segment[];
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
    { text, words, paragraphs: paragraphRefs, initialHighlightWordIndex, onWordClick },
    ref,
  ) {
    const wordElsRef = useRef<Map<number, HTMLSpanElement>>(new Map());
    const activeIndexRef = useRef<number | null>(null);
    const searchMatchIndicesRef = useRef<Set<number>>(new Set());
    const activeMatchIndexRef = useRef<number | null>(null);
    // Lazily-created; only needed once playback actually starts scrolling.
    const visibilityObserverRef = useRef<IntersectionObserver | null>(null);

    // Grouped by paragraph (not one flat span list) so each paragraph can be
    // its own `content-visibility: auto` block — see the perf note below.
    // Uses each ParagraphRef's own charStart/charEnd as the authoritative
    // bounds (not word-transition inference — an earlier version of this
    // inferred paragraph boundaries from where word.paragraphIndex changed,
    // which silently dropped each paragraph's trailing punctuation, since
    // that punctuation sits in the "gap" after the last word but was never
    // attributed to the paragraph that was just closed out).
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

        const segments: Segment[] = [];
        let cursor = paragraphRef.charStart;
        for (const word of paragraphWords) {
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

        result.push({ key: `p-${paragraphRef.index}`, segments });
      }

      return result;
    }, [text, words, paragraphRefs]);

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
                  for (const entry of entries) {
                    if (!entry.isIntersecting) {
                      entry.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      setActiveWord(initialHighlightWordIndex, false);
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
          <p key={paragraph.key} className="reading-paragraph">
            {paragraph.segments.map((segment) =>
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
          </p>
        ))}
      </div>
    );
  }),
);
