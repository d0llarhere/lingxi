import type { DocumentStructure, ReadingCursor, WordRef } from '../model/types';
import { buildChunkFromWord, DEFAULT_CHUNK_TARGET_CHARS } from './chunking';
import { computeProgress, findWordAtOrBeforeOffset, findWordIndexAtOrAfterOffset } from './cursorMath';
import { shouldSkipSentenceForSpeech } from './speechFilter';
import type { TTSEngine, VoiceInfo } from './ttsEngine';

export type PlaybackState = 'idle' | 'playing' | 'paused';

const MIN_RATE = 0.5;
const MAX_RATE = 3;

// How many chunks ahead to offer engines as a generation hint (see
// SpeakOptions.lookaheadTexts). Chunks are now large enough (~900 chars,
// easily tens of seconds of audio) that a single chunk of lookahead gives
// Kokoro's WASM inference comfortably more lead time than its own generation
// takes, even on a CPU with no GPU acceleration — unlike the old
// one-sentence-per-chunk design, where a single sentence of buffer wasn't
// enough lead time and every boundary stalled regardless of how early the
// lookahead started.
const LOOKAHEAD_CHUNK_COUNT = 1;

export interface PlaybackControllerOptions {
  documentId: string;
  structure: DocumentStructure;
  // The document's full raw text (same string segmentText(text) was built
  // from — see ARCHITECTURE.md's TTS chunking note). Needed so a chunk
  // spanning multiple sentences can be sliced directly by char offset rather
  // than reassembled from individual SentenceRef.text fragments, which would
  // lose whatever separated them (a paragraph break, or a segment
  // Intl.Segmenter produced but segmentText discarded as whitespace-only).
  documentText: string;
  initialCursor: ReadingCursor;
  initialVoiceURI: string | null;
  initialRate: number;
  // Listening settings (see useListeningDefaults.ts) — read once at
  // construction, not reactive to later setting changes within the same
  // controller instance (the Settings page and the reader are mutually
  // exclusive routes in this app, so that can't happen mid-session anyway).
  initialParagraphPauseMs?: number;
  initialSkipArtifacts?: boolean;
  // Overrides DEFAULT_CHUNK_TARGET_CHARS — exposed so tests can force
  // one-sentence-per-chunk granularity deterministically instead of relying
  // on short test fixtures to stay under the real default.
  chunkTargetChars?: number;
  ttsEngine: TTSEngine;
  persistCursor: (cursor: ReadingCursor) => void | Promise<void>;
  persistSettings: (settings: { selectedVoiceURI: string | null; playbackSpeed: number }) => void | Promise<void>;
  onStateChange?: (state: PlaybackState) => void;
  onCursorChange?: (cursor: ReadingCursor) => void;
  // Fallback-mode display hint only — never affects the persisted cursor.
  onEstimatedWordChange?: (wordIndex: number) => void;
  onPersistError?: (error: unknown) => void;
}

// The logical reading cursor is the source of truth for playback position —
// never the TTS engine's internal state (see ARCHITECTURE.md §6). This class
// owns that cursor and drives an injected TTSEngine one multi-sentence chunk
// at a time (see chunking.ts's buildChunkFromWord); it never reads
// speechSynthesis.paused/.pending/.speaking.
export class PlaybackController {
  private readonly documentId: string;
  private readonly structure: DocumentStructure;
  private readonly documentText: string;
  private readonly chunkTargetChars: number;
  private readonly ttsEngine: TTSEngine;
  private readonly persistCursorFn: PlaybackControllerOptions['persistCursor'];
  private readonly persistSettingsFn: PlaybackControllerOptions['persistSettings'];
  private readonly onStateChange?: PlaybackControllerOptions['onStateChange'];
  private readonly onCursorChange?: PlaybackControllerOptions['onCursorChange'];
  private readonly onEstimatedWordChange?: PlaybackControllerOptions['onEstimatedWordChange'];
  private readonly onPersistError?: PlaybackControllerOptions['onPersistError'];

  private readonly wordsBySentence: Map<number, WordRef[]> = new Map();
  private readonly sentenceFirstWordIndex: number[];
  // Mirrors sentenceFirstWordIndex exactly, for the pill player's
  // paragraph-granularity previous/next buttons (see
  // lingxi-redesign/REDESIGN_BRIEF.md) — a separate index rather than
  // deriving paragraph position from sentenceFirstWordIndex each call,
  // same reasoning that already justified the sentence one.
  private readonly paragraphFirstWordIndex: number[];
  private readonly totalLength: number;

  private cursor: ReadingCursor;
  private state: PlaybackState = 'idle';
  private voiceURI: string | null;
  private rate: number;
  private readonly paragraphPauseMs: number;
  private readonly skipArtifacts: boolean;
  private utteranceGeneration = 0;

  constructor(opts: PlaybackControllerOptions) {
    this.documentId = opts.documentId;
    this.structure = opts.structure;
    this.documentText = opts.documentText;
    this.chunkTargetChars = opts.chunkTargetChars ?? DEFAULT_CHUNK_TARGET_CHARS;
    this.cursor = opts.initialCursor;
    this.voiceURI = opts.initialVoiceURI;
    this.rate = clampRate(opts.initialRate);
    this.paragraphPauseMs = opts.initialParagraphPauseMs ?? 0;
    this.skipArtifacts = opts.initialSkipArtifacts ?? false;
    this.ttsEngine = opts.ttsEngine;
    this.persistCursorFn = opts.persistCursor;
    this.persistSettingsFn = opts.persistSettings;
    this.onStateChange = opts.onStateChange;
    this.onCursorChange = opts.onCursorChange;
    this.onEstimatedWordChange = opts.onEstimatedWordChange;
    this.onPersistError = opts.onPersistError;

    this.sentenceFirstWordIndex = new Array(this.structure.sentences.length).fill(-1);
    this.paragraphFirstWordIndex = new Array(this.structure.paragraphs.length).fill(-1);
    for (const word of this.structure.words) {
      let bucket = this.wordsBySentence.get(word.sentenceIndex);
      if (!bucket) {
        bucket = [];
        this.wordsBySentence.set(word.sentenceIndex, bucket);
      }
      bucket.push(word);
      if (this.sentenceFirstWordIndex[word.sentenceIndex] === -1) {
        this.sentenceFirstWordIndex[word.sentenceIndex] = word.index;
      }
      if (this.paragraphFirstWordIndex[word.paragraphIndex] === -1) {
        this.paragraphFirstWordIndex[word.paragraphIndex] = word.index;
      }
    }

    const lastPage = this.structure.pages.at(-1);
    this.totalLength = lastPage ? lastPage.charEnd : 0;
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCursor(): ReadingCursor {
    return this.cursor;
  }

  getProgress(): number {
    return computeProgress(this.cursor.charOffset, this.totalLength);
  }

  getVoices(): Promise<VoiceInfo[]> {
    return this.ttsEngine.listVoices();
  }

  // Starts playback (idle) or resumes it (paused) — both are the same
  // operation: speak from the exact persisted cursor. Does not advance the
  // cursor and does not re-persist it (it was already persisted by whatever
  // last moved it).
  play(): void {
    if (this.state === 'playing') return;
    const word = this.structure.words[this.cursor.wordIndex];
    if (!word) return; // empty document — nothing to read

    this.state = 'playing';
    this.notifyState();
    this.speakFrom(word);
  }

  // Determines the current cursor (already up to date from the last
  // confirmed boundary), persists it immediately, and stops the underlying
  // utterance. Never advances the cursor.
  pause(): void {
    if (this.state !== 'playing') return;
    this.cancelPlayback();
    this.state = 'paused';
    this.persistCursorNow();
    this.notifyState();
  }

  // Distinct from pause(): moves to idle, but — same as pause — persists the
  // current cursor unchanged. Stop never rewinds to the start; the next
  // play() resumes from exactly where Stop was pressed.
  stop(): void {
    if (this.state === 'idle') return;
    this.cancelPlayback();
    this.state = 'idle';
    this.persistCursorNow();
    this.notifyState();
  }

  previousSentence(): void {
    const target = this.findSentenceWithWords(this.cursor.sentenceIndex - 1, -1);
    if (target === null) return;
    this.seekToWord(this.sentenceFirstWordIndex[target] as number);
  }

  nextSentence(): void {
    const target = this.findSentenceWithWords(this.cursor.sentenceIndex + 1, 1);
    if (target === null) return;
    this.seekToWord(this.sentenceFirstWordIndex[target] as number);
  }

  // Paragraph-granularity equivalents of previousSentence()/nextSentence() —
  // the pill player's prev/next buttons (see lingxi-redesign's
  // REDESIGN_BRIEF.md), not used internally by chunk advancement, which
  // still steps sentence-by-sentence (see handleUtteranceEnd).
  previousParagraph(): void {
    const target = this.findParagraphWithWords(this.cursor.paragraphIndex - 1, -1);
    if (target === null) return;
    this.seekToWord(this.paragraphFirstWordIndex[target] as number);
  }

  nextParagraph(): void {
    const target = this.findParagraphWithWords(this.cursor.paragraphIndex + 1, 1);
    if (target === null) return;
    this.seekToWord(this.paragraphFirstWordIndex[target] as number);
  }

  // Click-to-read: stop current playback, move+persist the cursor, begin
  // playback from that word.
  seekToWord(wordIndex: number): void {
    const word = this.structure.words[wordIndex];
    if (!word) return;

    this.cancelPlayback();
    this.setCursorFromWord(word);
    this.persistCursorNow();
    this.state = 'playing';
    this.notifyState();
    this.speakFrom(word);
  }

  // Progress-bar seek: fraction in [0,1] of the document's total length.
  seekToProgress(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    const targetOffset = clamped * this.totalLength;
    const wordIndex = findWordIndexAtOrAfterOffset(this.structure.words, targetOffset);
    if (wordIndex === null) return;
    this.seekToWord(wordIndex);
  }

  setSpeed(rate: number): void {
    this.rate = clampRate(rate);
    this.persistSettingsNow();
    if (this.state === 'playing') {
      const word = this.structure.words[this.cursor.wordIndex];
      if (word) {
        this.cancelPlayback();
        this.speakFrom(word);
      }
    }
  }

  setVoice(voiceURI: string | null): void {
    this.voiceURI = voiceURI;
    this.persistSettingsNow();
    if (this.state === 'playing') {
      const word = this.structure.words[this.cursor.wordIndex];
      if (word) {
        this.cancelPlayback();
        this.speakFrom(word);
      }
    }
  }

  // Cleanup for component unmount / document switch.
  destroy(): void {
    this.cancelPlayback();
  }

  // stopAtParagraphBoundary follows directly from whether a pause is even
  // configured — see chunking.ts's ChunkWalkOptions doc comment: this is how
  // "every chunk end is a paragraph end" becomes true whenever a pause is
  // wanted, with no separate on/off setting of its own.
  private get chunkWalkOptions() {
    return { stopAtParagraphBoundary: this.paragraphPauseMs > 0, skipArtifacts: this.skipArtifacts };
  }

  private speakFrom(word: WordRef): void {
    const chunk = buildChunkFromWord(
      this.structure,
      this.documentText,
      this.wordsBySentence,
      word,
      this.chunkTargetChars,
      this.chunkWalkOptions,
    );
    const baseOffset = word.charStart;

    // Peek at the next chunk(s) (without moving the cursor there) so engines
    // that need to render a whole utterance before playing any of it can
    // start on them now, overlapping generation with this chunk's playback
    // instead of only starting once onEnd fires. See LOOKAHEAD_CHUNK_COUNT.
    const lookaheadTexts: string[] = [];
    let lookaheadSentenceCursor = chunk.lastSentenceIndex;
    for (let i = 0; i < LOOKAHEAD_CHUNK_COUNT; i++) {
      const next = this.findSentenceWithWords(lookaheadSentenceCursor + 1, 1);
      if (next === null) break;
      const nextWord = this.structure.words[this.sentenceFirstWordIndex[next] as number];
      if (!nextWord) break;
      const lookaheadChunk = buildChunkFromWord(
        this.structure,
        this.documentText,
        this.wordsBySentence,
        nextWord,
        this.chunkTargetChars,
        this.chunkWalkOptions,
      );
      lookaheadTexts.push(lookaheadChunk.text);
      lookaheadSentenceCursor = lookaheadChunk.lastSentenceIndex;
    }

    // Every speak() call gets a generation number. Calling ttsEngine.cancel()
    // (from pause/stop/seek/setSpeed/setVoice) reliably stops audio, but
    // browsers are inconsistent about *which* callback fires afterward for
    // the cancelled utterance — Chrome fires onerror with error:'canceled'
    // rather than silently discarding it. Without this guard, that stale
    // error would race with (and could clobber) the state pause()/stop()/a
    // newer speakFrom() had already set. Any callback whose generation no
    // longer matches the latest one is from a superseded utterance and is
    // ignored outright.
    this.utteranceGeneration += 1;
    const generation = this.utteranceGeneration;
    const lastSentenceIndex = chunk.lastSentenceIndex;

    this.ttsEngine.speak(chunk.text, {
      voiceURI: this.voiceURI,
      rate: this.rate,
      lookaheadTexts,
      onWordBoundary: (charIndex, confirmed) =>
        this.handleBoundary(charIndex, confirmed, baseOffset, chunk.chunkWords, generation),
      onEnd: () => this.handleUtteranceEnd(lastSentenceIndex, generation),
      onError: (error) => this.handleUtteranceError(error, generation),
    });
  }

  private handleBoundary(
    charIndexInUtterance: number,
    confirmed: boolean,
    baseOffset: number,
    chunkWords: WordRef[],
    generation: number,
  ): void {
    if (generation !== this.utteranceGeneration) return; // stale/superseded utterance

    const globalOffset = baseOffset + charIndexInUtterance;
    const word = findWordAtOrBeforeOffset(chunkWords, globalOffset);
    if (!word) return;

    if (confirmed) {
      this.setCursorFromWord(word);
      this.persistCursorNow();
    } else {
      this.onEstimatedWordChange?.(word.index);
    }
  }

  private handleUtteranceError(error: unknown, generation: number): void {
    if (generation !== this.utteranceGeneration) return; // superseded by a newer utterance
    // pause()/stop() call cancel() deliberately, which Chrome surfaces as an
    // error:'canceled' on this same utterance — not a genuine failure. If
    // we're no longer 'playing', this error is that expected side effect.
    if (this.state !== 'playing') return;

    this.state = 'idle';
    this.notifyState();
    this.onPersistError?.(error);
  }

  // `finishedLastSentenceIndex` is the chunk's *last* sentence, not
  // necessarily the one speakFrom() started at — a chunk groups several.
  private handleUtteranceEnd(finishedLastSentenceIndex: number, generation: number): void {
    if (generation !== this.utteranceGeneration) return; // stale/superseded utterance
    // Also guards the (much rarer) race where a legitimate onEnd for the
    // current utterance arrives just after pause()/stop() already changed
    // state — without this, it would incorrectly resume playback.
    if (this.state !== 'playing') return;

    const nextSentence = this.findSentenceWithWords(finishedLastSentenceIndex + 1, 1);
    if (nextSentence === null) {
      // Document finished. Cursor already sits on the last confirmed word.
      this.state = 'idle';
      this.notifyState();
      return;
    }

    const nextWord = this.structure.words[this.sentenceFirstWordIndex[nextSentence] as number];
    if (!nextWord) {
      this.state = 'idle';
      this.notifyState();
      return;
    }

    this.setCursorFromWord(nextWord);
    this.persistCursorNow();

    if (this.paragraphPauseMs > 0) {
      // stopAtParagraphBoundary (see chunkWalkOptions) guarantees every
      // chunk end reached here is a real paragraph end, so the pause can
      // apply unconditionally rather than re-checking paragraphIndex.
      window.setTimeout(() => {
        if (generation !== this.utteranceGeneration) return; // superseded mid-pause (pause/stop/seek)
        if (this.state !== 'playing') return;
        this.speakFrom(nextWord);
      }, this.paragraphPauseMs);
    } else {
      this.speakFrom(nextWord);
    }
  }

  // Skip-artifact sentences (see speechFilter.ts) are treated as invisible
  // here too, not just inside chunking.ts's own walk — otherwise this could
  // land the cursor exactly on a sentence that chunk-building would then
  // immediately exclude from what's actually spoken (see handleUtteranceEnd,
  // the caller that matters most: advancing to "the next sentence to
  // speak").
  private findSentenceWithWords(start: number, step: 1 | -1): number | null {
    let index = start;
    while (index >= 0 && index < this.sentenceFirstWordIndex.length) {
      if (this.sentenceFirstWordIndex[index] !== -1) {
        const sentence = this.structure.sentences[index];
        if (!this.skipArtifacts || !sentence || !shouldSkipSentenceForSpeech(sentence)) return index;
      }
      index += step;
    }
    return null;
  }

  private findParagraphWithWords(start: number, step: 1 | -1): number | null {
    let index = start;
    while (index >= 0 && index < this.paragraphFirstWordIndex.length) {
      if (this.paragraphFirstWordIndex[index] !== -1) return index;
      index += step;
    }
    return null;
  }

  private setCursorFromWord(word: WordRef): void {
    this.cursor = {
      documentId: this.documentId,
      wordIndex: word.index,
      charOffset: word.charStart,
      pageIndex: word.pageIndex,
      paragraphIndex: word.paragraphIndex,
      sentenceIndex: word.sentenceIndex,
      updatedAt: Date.now(),
    };
    this.onCursorChange?.(this.cursor);
  }

  private cancelPlayback(): void {
    this.ttsEngine.cancel();
  }

  private persistCursorNow(): void {
    try {
      const result = this.persistCursorFn(this.cursor);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => this.onPersistError?.(error));
      }
    } catch (error) {
      this.onPersistError?.(error);
    }
  }

  private persistSettingsNow(): void {
    try {
      const result = this.persistSettingsFn({ selectedVoiceURI: this.voiceURI, playbackSpeed: this.rate });
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => this.onPersistError?.(error));
      }
    } catch (error) {
      this.onPersistError?.(error);
    }
  }

  private notifyState(): void {
    this.onStateChange?.(this.state);
  }
}

function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}
