import type { WordRef } from '@lingxi/core';
import { useMemo } from 'react';

interface WordTextProps {
  text: string;
  words: WordRef[];
  highlightWordIndex: number | null;
  onWordClick: (wordIndex: number) => void;
}

interface Segment {
  key: string;
  isWord: boolean;
  content: string;
  wordIndex: number;
}

// Reconstructs the exact original text (whitespace/punctuation included) as a
// sequence of spans, so only real "words" (per segmentText's WordRef list)
// are clickable, and the currently spoken one can be highlighted. Segments
// are memoized on (text, words) only, not on the highlight index, so a
// re-render during playback just restyles existing spans rather than
// rebuilding the whole list.
export function WordText({ text, words, highlightWordIndex, onWordClick }: WordTextProps) {
  const segments = useMemo<Segment[]>(() => {
    const result: Segment[] = [];
    let cursor = 0;

    words.forEach((word) => {
      if (word.charStart > cursor) {
        result.push({ key: `gap-${word.index}`, isWord: false, content: text.slice(cursor, word.charStart), wordIndex: -1 });
      }
      result.push({
        key: `word-${word.index}`,
        isWord: true,
        content: text.slice(word.charStart, word.charEnd),
        wordIndex: word.index,
      });
      cursor = word.charEnd;
    });

    if (cursor < text.length) {
      result.push({ key: 'gap-end', isWord: false, content: text.slice(cursor), wordIndex: -1 });
    }

    return result;
  }, [text, words]);

  return (
    <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
      {segments.map((segment) =>
        segment.isWord ? (
          <span
            key={segment.key}
            role="button"
            tabIndex={0}
            onClick={() => onWordClick(segment.wordIndex)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onWordClick(segment.wordIndex);
              }
            }}
            style={{
              cursor: 'pointer',
              backgroundColor: segment.wordIndex === highlightWordIndex ? '#ffe58a' : 'transparent',
            }}
          >
            {segment.content}
          </span>
        ) : (
          <span key={segment.key}>{segment.content}</span>
        ),
      )}
    </article>
  );
}
