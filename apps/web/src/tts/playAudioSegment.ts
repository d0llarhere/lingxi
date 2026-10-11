import type { SpeakOptions, WordAnchor } from '@lingxi/core';

export interface AudioPlaybackHandle {
  cancel(): void;
}

// The one "play a Blob with highlighting" implementation, used by
// EdgeTTSEngine.speak() and by CachingTTSEngine's cache-hit and
// cache-miss-then-play paths (for both engines) — extracted so there's
// exactly one place driving highlighting from real WordAnchor[] (when
// present, `confirmed: true`, stepping through anchors as `audio.currentTime`
// crosses each one) or a fraction-based estimate (`confirmed: false`, same
// convention Kokoro/WebSpeech use when no real boundary events exist).
//
// Deliberately knows nothing about any caller's own generation/token
// tracking — callers that need to ignore stale/superseded callbacks (every
// current caller does) wrap their own guard around the `opts` they pass in.
export function playAudioSegment(blob: Blob, text: string, words: WordAnchor[], opts: SpeakOptions): AudioPlaybackHandle {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(url);
  };

  if (words.length > 0) {
    const boundaries = scheduleBoundaries(text, words);
    let nextBoundary = 0;
    audio.ontimeupdate = () => {
      const nowMs = audio.currentTime * 1000;
      while (nextBoundary < boundaries.length && nowMs >= boundaries[nextBoundary]!.offsetMs) {
        opts.onWordBoundary?.(boundaries[nextBoundary]!.charIndex, true);
        nextBoundary++;
      }
    };
  } else {
    audio.ontimeupdate = () => {
      if (!audio.duration || !isFinite(audio.duration)) return;
      const fraction = Math.min(1, audio.currentTime / audio.duration);
      opts.onWordBoundary?.(Math.floor(fraction * text.length), false);
    };
  }

  audio.onended = () => {
    release();
    opts.onEnd();
  };
  audio.onerror = () => {
    release();
    opts.onError(new Error('Audio playback failed.'));
  };

  audio.play().catch((error: unknown) => {
    release();
    opts.onError(error);
  });

  return {
    cancel() {
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      release();
    },
  };
}

// The proxy's word anchors carry the literal spoken word but not a char
// index into `text` — matched back on by searching for each word in order,
// rather than trusting any offset as a direct index (SSML escaping etc. can
// shift things). Skips a reported word that doesn't literally appear in
// `text` rather than guessing.
function scheduleBoundaries(text: string, words: WordAnchor[]): { offsetMs: number; charIndex: number }[] {
  const boundaries: { offsetMs: number; charIndex: number }[] = [];
  let cursor = 0;
  for (const word of words) {
    const charIndex = text.indexOf(word.text, cursor);
    if (charIndex === -1) continue;
    cursor = charIndex + word.text.length;
    boundaries.push({ offsetMs: word.offsetMs, charIndex });
  }
  return boundaries;
}
