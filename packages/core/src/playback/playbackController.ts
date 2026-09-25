import type { DocumentStructure, ReadingCursor, WordRef } from '../model/types';
import { computeProgress, findWordAtOrBeforeOffset, findWordIndexAtOrAfterOffset } from './cursorMath';
import type { TTSEngine, VoiceInfo } from './ttsEngine';

export type PlaybackState = 'idle' | 'playing' | 'paused';

const MIN_RATE = 0.5;
const MAX_RATE = 3;

export interface PlaybackControllerOptions {
  documentId: string;
  structure: DocumentStructure;
  initialCursor: ReadingCursor;
  initialVoiceURI: string | null;
  initialRate: number;
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
// owns that cursor and drives an injected TTSEngine one sentence at a time;
// it never reads speechSynthesis.paused/.pending/.speaking.
export class PlaybackController {
  private readonly documentId: string;
  private readonly structure: DocumentStructure;
  private readonly ttsEngine: TTSEngine;
  private readonly persistCursorFn: PlaybackControllerOptions['persistCursor'];
  private readonly persistSettingsFn: PlaybackControllerOptions['persistSettings'];
  private readonly onStateChange?: PlaybackControllerOptions['onStateChange'];
  private readonly onCursorChange?: PlaybackControllerOptions['onCursorChange'];
  private readonly onEstimatedWordChange?: PlaybackControllerOptions['onEstimatedWordChange'];
  private readonly onPersistError?: PlaybackControllerOptions['onPersistError'];

  private readonly wordsBySentence: Map<number, WordRef[]> = new Map();
  private readonly sentenceFirstWordIndex: number[];
  private readonly totalLength: number;

  private cursor: ReadingCursor;
  private state: PlaybackState = 'idle';
  private voiceURI: string | null;
  private rate: number;
  private utteranceGeneration = 0;

  constructor(opts: PlaybackControllerOptions) {
    this.documentId = opts.documentId;
    this.structure = opts.structure;
    this.cursor = opts.initialCursor;
    this.voiceURI = opts.initialVoiceURI;
    this.rate = clampRate(opts.initialRate);
    this.ttsEngine = opts.ttsEngine;
    this.persistCursorFn = opts.persistCursor;
    this.persistSettingsFn = opts.persistSettings;
    this.onStateChange = opts.onStateChange;
    this.onCursorChange = opts.onCursorChange;
    this.onEstimatedWordChange = opts.onEstimatedWordChange;
    this.onPersistError = opts.onPersistError;

    this.sentenceFirstWordIndex = new Array(this.structure.sentences.length).fill(-1);
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

  private speakFrom(word: WordRef): void {
    const sentence = this.structure.sentences[word.sentenceIndex];
    if (!sentence) return;

    const localOffset = word.charStart - sentence.charStart;
    const text = sentence.text.slice(localOffset);
    const sentenceWords = this.wordsBySentence.get(word.sentenceIndex) ?? [word];
    const baseOffset = word.charStart;
    const sentenceIndex = word.sentenceIndex;

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

    this.ttsEngine.speak(text, {
      voiceURI: this.voiceURI,
      rate: this.rate,
      onWordBoundary: (charIndex, confirmed) =>
        this.handleBoundary(charIndex, confirmed, baseOffset, sentenceWords, generation),
      onEnd: () => this.handleUtteranceEnd(sentenceIndex, generation),
      onError: (error) => this.handleUtteranceError(error, generation),
    });
  }

  private handleBoundary(
    charIndexInUtterance: number,
    confirmed: boolean,
    baseOffset: number,
    sentenceWords: WordRef[],
    generation: number,
  ): void {
    if (generation !== this.utteranceGeneration) return; // stale/superseded utterance

    const globalOffset = baseOffset + charIndexInUtterance;
    const word = findWordAtOrBeforeOffset(sentenceWords, globalOffset);
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

  private handleUtteranceEnd(finishedSentenceIndex: number, generation: number): void {
    if (generation !== this.utteranceGeneration) return; // stale/superseded utterance
    // Also guards the (much rarer) race where a legitimate onEnd for the
    // current utterance arrives just after pause()/stop() already changed
    // state — without this, it would incorrectly resume playback.
    if (this.state !== 'playing') return;

    const nextSentence = this.findSentenceWithWords(finishedSentenceIndex + 1, 1);
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
    this.speakFrom(nextWord);
  }

  private findSentenceWithWords(start: number, step: 1 | -1): number | null {
    let index = start;
    while (index >= 0 && index < this.sentenceFirstWordIndex.length) {
      if (this.sentenceFirstWordIndex[index] !== -1) return index;
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
