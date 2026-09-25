import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentStructure, ReadingCursor } from '../src/model/types';
import { PlaybackController } from '../src/playback/playbackController';
import { segmentText } from '../src/segmentation/segmentText';
import type { SpeakOptions, TTSEngine, VoiceInfo } from '../src/playback/ttsEngine';

// Test double for the browser-specific adapter. Captures every speak() call
// so tests can manually fire onWordBoundary/onEnd to simulate playback
// deterministically, without any real timers or speechSynthesis.
class FakeTTSEngine implements TTSEngine {
  speakCalls: Array<{ text: string; opts: SpeakOptions }> = [];
  cancelCallCount = 0;

  get lastSpeak() {
    return this.speakCalls.at(-1) ?? null;
  }

  speak(text: string, opts: SpeakOptions): void {
    this.speakCalls.push({ text, opts });
  }

  cancel(): void {
    this.cancelCallCount++;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [];
  }
}

function initialCursor(documentId: string): ReadingCursor {
  return {
    documentId,
    wordIndex: 0,
    charOffset: 0,
    pageIndex: 0,
    paragraphIndex: 0,
    sentenceIndex: 0,
    updatedAt: 0,
  };
}

function makeController(
  structure: DocumentStructure,
  overrides: Partial<{ persistCursor: (c: ReadingCursor) => void }> = {},
) {
  const documentId = 'doc-1';
  const engine = new FakeTTSEngine();
  const persistCursor = vi.fn(overrides.persistCursor ?? (() => {}));
  const persistSettings = vi.fn();
  const onCursorChange = vi.fn();
  const onStateChange = vi.fn();
  const onEstimatedWordChange = vi.fn();

  const controller = new PlaybackController({
    documentId,
    structure,
    initialCursor: initialCursor(documentId),
    initialVoiceURI: null,
    initialRate: 1,
    ttsEngine: engine,
    persistCursor,
    persistSettings,
    onCursorChange,
    onStateChange,
    onEstimatedWordChange,
  });

  return { controller, engine, persistCursor, persistSettings, onCursorChange, onStateChange, onEstimatedWordChange };
}

const THREE_SENTENCE_TEXT = 'First sentence here. Second sentence here. Third sentence here.';

describe('PlaybackController', () => {
  let structure: DocumentStructure;

  beforeEach(() => {
    structure = segmentText(THREE_SENTENCE_TEXT);
  });

  it('1. exposes the initial cursor without touching the TTS engine', () => {
    const { controller, engine } = makeController(structure);
    expect(controller.getCursor().wordIndex).toBe(0);
    expect(controller.getCursor().sentenceIndex).toBe(0);
    expect(engine.speakCalls).toHaveLength(0);
    expect(controller.getState()).toBe('idle');
  });

  it('2. advances the cursor to the next sentence when the current one ends', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    expect(engine.speakCalls).toHaveLength(1);

    engine.lastSpeak!.opts.onEnd();

    expect(controller.getCursor().sentenceIndex).toBe(1);
    expect(engine.speakCalls).toHaveLength(2);
    expect(engine.lastSpeak!.text.startsWith('Second')).toBe(true);
  });

  it('3. advances the cursor word by word on confirmed boundaries within a sentence', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const sentenceWords = structure.words.filter((w) => w.sentenceIndex === 0);

    sentenceWords.forEach((word, i) => {
      engine.lastSpeak!.opts.onWordBoundary?.(i === 0 ? 0 : word.charStart - (sentenceWords[0]?.charStart ?? 0), true);
      expect(controller.getCursor().wordIndex).toBe(word.index);
    });
  });

  it('4. maps a confirmed boundary to the correct global character offset', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const word = structure.words[1];
    if (!word) throw new Error('expected a word');
    const sentence = structure.sentences[0];
    if (!sentence) throw new Error('expected a sentence');
    const localOffset = word.charStart - sentence.charStart;

    engine.lastSpeak!.opts.onWordBoundary?.(localOffset, true);

    expect(controller.getCursor().charOffset).toBe(word.charStart);
    expect(controller.getCursor().wordIndex).toBe(word.index);
  });

  it('5. maps a boundary that lands mid-word back to that word, not the next one', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const word = structure.words[1];
    if (!word) throw new Error('expected a word');
    const sentence = structure.sentences[0];
    if (!sentence) throw new Error('expected a sentence');
    const midWordOffset = word.charStart - sentence.charStart + 1;

    engine.lastSpeak!.opts.onWordBoundary?.(midWordOffset, true);

    expect(controller.getCursor().wordIndex).toBe(word.index);
  });

  it('correctly rebases boundary offsets after seeking mid-sentence (not sentence-relative)', () => {
    const { controller, engine } = makeController(structure);
    const targetWord = structure.words.find((w) => w.sentenceIndex === 1 && w.index > (structure.sentences[1]?.charStart ?? 0));
    const secondSentenceWords = structure.words.filter((w) => w.sentenceIndex === 1);
    const midWord = secondSentenceWords[1];
    if (!midWord) throw new Error('expected a second word in sentence 2');

    controller.seekToWord(midWord.index);
    // The utterance text starts AT midWord, so charIndex 0 in that utterance
    // must resolve back to midWord itself via the baseOffset rebasing.
    engine.lastSpeak!.opts.onWordBoundary?.(0, true);

    expect(controller.getCursor().wordIndex).toBe(midWord.index);
    void targetWord;
  });

  it('regression: a "canceled" error from our own pause() does not clobber the paused state', () => {
    // Reproduces a real bug found in manual Chrome testing: calling
    // speechSynthesis.cancel() (from pause()) causes Chrome to fire the
    // utterance's onerror with error:'canceled' shortly afterward. That
    // callback must not overwrite the 'paused' state pause() already set.
    const { controller, engine } = makeController(structure);
    controller.play();
    const activeUtterance = engine.lastSpeak!;

    controller.pause();
    expect(controller.getState()).toBe('paused');

    activeUtterance.opts.onError({ error: 'canceled' });

    expect(controller.getState()).toBe('paused');
  });

  it('regression: a "canceled" error from seekToWord does not clobber the new utterance already in progress', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const staleUtterance = engine.lastSpeak!;

    const targetWord = structure.words.find((w) => w.sentenceIndex === 1);
    if (!targetWord) throw new Error('expected a word');
    controller.seekToWord(targetWord.index);
    expect(controller.getState()).toBe('playing');

    staleUtterance.opts.onError({ error: 'canceled' }); // stale callback from the superseded utterance

    expect(controller.getState()).toBe('playing');
  });

  it('6. pause preserves the cursor exactly and does not advance it', () => {
    const { controller, engine, persistCursor } = makeController(structure);
    controller.play();
    const word1 = structure.words[1];
    if (!word1) throw new Error('expected a word');
    engine.lastSpeak!.opts.onWordBoundary?.(word1.charStart, true);

    const cursorBeforePause = controller.getCursor();
    controller.pause();

    expect(controller.getCursor()).toEqual(cursorBeforePause);
    expect(controller.getState()).toBe('paused');
    expect(engine.cancelCallCount).toBe(1);
    expect(persistCursor).toHaveBeenCalledWith(cursorBeforePause);
  });

  it('7. resume (play after pause) starts the TTS chunk from the persisted cursor, not the sentence start', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const word1 = structure.words[1];
    if (!word1) throw new Error('expected a word');
    engine.lastSpeak!.opts.onWordBoundary?.(word1.charStart, true);
    controller.pause();

    controller.play();

    const sentence = structure.sentences[0];
    if (!sentence) throw new Error('expected sentence');
    const expectedText = sentence.text.slice(word1.charStart - sentence.charStart);
    expect(engine.lastSpeak!.text).toBe(expectedText);
    expect(controller.getState()).toBe('playing');
  });

  it('8. stop preserves the cursor (does not reset to word 0) and next play resumes from it', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const word1 = structure.words[1];
    if (!word1) throw new Error('expected a word');
    engine.lastSpeak!.opts.onWordBoundary?.(word1.charStart, true);

    controller.stop();
    expect(controller.getState()).toBe('idle');
    expect(controller.getCursor().wordIndex).toBe(word1.index);
    expect(controller.getCursor().wordIndex).not.toBe(0);

    controller.play();
    const sentence = structure.sentences[0];
    if (!sentence) throw new Error('expected sentence');
    expect(engine.lastSpeak!.text).toBe(sentence.text.slice(word1.charStart - sentence.charStart));
  });

  it('9. click-to-read (seekToWord) stops current playback, moves+persists the cursor, and starts reading there', () => {
    const { controller, engine, persistCursor } = makeController(structure);
    controller.play();
    const targetWord = structure.words.find((w) => w.sentenceIndex === 2);
    if (!targetWord) throw new Error('expected a word in sentence 3');

    controller.seekToWord(targetWord.index);

    expect(engine.cancelCallCount).toBeGreaterThanOrEqual(1);
    expect(controller.getCursor().wordIndex).toBe(targetWord.index);
    expect(persistCursor).toHaveBeenCalledWith(expect.objectContaining({ wordIndex: targetWord.index }));
    expect(controller.getState()).toBe('playing');
    expect(engine.lastSpeak!.text.length).toBeGreaterThan(0);
  });

  it('10. progress calculation reflects charOffset over total document length', () => {
    const { controller, engine } = makeController(structure);
    expect(controller.getProgress()).toBe(0);

    controller.play();
    const lastWord = structure.words.at(-1);
    if (!lastWord) throw new Error('expected words');
    engine.lastSpeak!.opts.onWordBoundary?.(0, true); // trivial boundary, just to exercise the path
    controller.seekToWord(lastWord.index);

    const lastPage = structure.pages.at(-1);
    if (!lastPage) throw new Error('expected a page');
    expect(controller.getProgress()).toBeCloseTo(lastWord.charStart / lastPage.charEnd, 5);
  });

  it('10b. progress is 0 (not NaN) for a document with no words', () => {
    const empty = segmentText('');
    const { controller } = makeController(empty);
    expect(controller.getProgress()).toBe(0);
  });

  it('11. seekToProgress maps a fraction to the correct word and begins playback there', () => {
    const { controller, engine } = makeController(structure);

    controller.seekToProgress(0);
    expect(controller.getCursor().wordIndex).toBe(0);

    controller.seekToProgress(1);
    const lastWord = structure.words.at(-1);
    if (!lastWord) throw new Error('expected words');
    expect(controller.getCursor().wordIndex).toBe(lastWord.index);
    expect(engine.speakCalls.length).toBeGreaterThan(0);
  });

  it('12. only confirmed boundaries persist the cursor; estimated ones only update the display hint', () => {
    const { controller, engine, persistCursor, onEstimatedWordChange } = makeController(structure);
    controller.play();
    persistCursor.mockClear();

    const word1 = structure.words[1];
    if (!word1) throw new Error('expected a word');
    const sentence = structure.sentences[0];
    if (!sentence) throw new Error('expected sentence');
    const localOffset = word1.charStart - sentence.charStart;

    engine.lastSpeak!.opts.onWordBoundary?.(localOffset, false); // estimated
    expect(persistCursor).not.toHaveBeenCalled();
    expect(controller.getCursor().wordIndex).toBe(0); // unchanged
    expect(onEstimatedWordChange).toHaveBeenCalledWith(word1.index);

    engine.lastSpeak!.opts.onWordBoundary?.(localOffset, true); // confirmed
    expect(persistCursor).toHaveBeenCalled();
    expect(controller.getCursor().wordIndex).toBe(word1.index);
  });

  it('13. a freshly constructed controller reflects a restored (non-zero) cursor immediately', () => {
    const word2 = structure.words[2];
    if (!word2) throw new Error('expected a word');
    const engine = new FakeTTSEngine();
    const controller = new PlaybackController({
      documentId: 'doc-1',
      structure,
      initialCursor: {
        documentId: 'doc-1',
        wordIndex: word2.index,
        charOffset: word2.charStart,
        pageIndex: word2.pageIndex,
        paragraphIndex: word2.paragraphIndex,
        sentenceIndex: word2.sentenceIndex,
        updatedAt: Date.now(),
      },
      initialVoiceURI: null,
      initialRate: 1,
      ttsEngine: engine,
      persistCursor: () => {},
      persistSettings: () => {},
    });

    expect(controller.getState()).toBe('idle');
    expect(controller.getCursor().wordIndex).toBe(word2.index);
    expect(engine.speakCalls).toHaveLength(0); // restoring does not auto-play
  });

  it('14. is a safe no-op on an empty document', () => {
    const empty = segmentText('');
    const { controller, engine } = makeController(empty);

    controller.play();
    controller.pause();
    controller.stop();
    controller.previousSentence();
    controller.nextSentence();
    controller.seekToWord(0);
    controller.seekToProgress(0.5);

    expect(engine.speakCalls).toHaveLength(0);
    expect(controller.getState()).toBe('idle');
    expect(controller.getProgress()).toBe(0);
  });

  it('15. handles a long document (many sentences) without breaking cursor correctness', () => {
    const longText = Array.from({ length: 500 }, (_, i) => `Sentence number ${i} has some words in it.`).join(' ');
    const longStructure = segmentText(longText);
    const { controller, engine } = makeController(longStructure);

    controller.play();
    for (let i = 0; i < longStructure.sentences.length - 1; i++) {
      engine.lastSpeak!.opts.onEnd();
    }

    expect(controller.getCursor().sentenceIndex).toBe(longStructure.sentences.length - 1);
    expect(controller.getState()).toBe('playing');
  });

  it('16. reaching the end of the final sentence completes the document (idle, no further speak calls, cursor at last word)', () => {
    const { controller, engine } = makeController(structure);
    controller.play();

    // Drive through all sentences.
    for (let i = 0; i < structure.sentences.length - 1; i++) {
      engine.lastSpeak!.opts.onEnd();
    }

    // Confirm reaching the true last word of the final sentence (only
    // confirmed boundaries advance the cursor mid-sentence) before it ends.
    const lastWord = structure.words.at(-1);
    const lastSentence = structure.sentences.at(-1);
    if (!lastWord || !lastSentence) throw new Error('expected words and a sentence');
    engine.lastSpeak!.opts.onWordBoundary?.(lastWord.charStart - lastSentence.charStart, true);

    const speakCallsBeforeFinalEnd = engine.speakCalls.length;
    engine.lastSpeak!.opts.onEnd(); // ends the last sentence -> document complete

    expect(controller.getState()).toBe('idle');
    expect(engine.speakCalls).toHaveLength(speakCallsBeforeFinalEnd); // no further speak() calls
    expect(controller.getCursor().wordIndex).toBe(lastWord.index);
  });

  it('previousSentence/nextSentence move the cursor to the adjacent sentence and start reading there', () => {
    const { controller, engine } = makeController(structure);
    controller.play();

    controller.nextSentence();
    expect(controller.getCursor().sentenceIndex).toBe(1);
    expect(engine.lastSpeak!.text.startsWith('Second')).toBe(true);

    controller.previousSentence();
    expect(controller.getCursor().sentenceIndex).toBe(0);
    expect(engine.lastSpeak!.text.startsWith('First')).toBe(true);
  });

  it('previousSentence at the first sentence and nextSentence at the last sentence are safe no-ops', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    engine.cancelCallCount = 0;

    controller.previousSentence();
    expect(controller.getCursor().sentenceIndex).toBe(0);

    controller.seekToWord(structure.words.at(-1)!.index);
    const callsAfterSeek = engine.speakCalls.length;
    controller.nextSentence();
    expect(engine.speakCalls).toHaveLength(callsAfterSeek); // no-op, no new speak call
  });

  it('a stale onEnd from a cancelled utterance does not advance the cursor after pause', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const staleOnEnd = engine.lastSpeak!.opts.onEnd;
    controller.pause();

    staleOnEnd(); // simulate a late-arriving onEnd from the cancelled utterance

    expect(controller.getCursor().sentenceIndex).toBe(0);
    expect(controller.getState()).toBe('paused');
  });

  it('setSpeed restarts the current word safely while playing, and just stores it while paused', () => {
    const { controller, engine } = makeController(structure);
    controller.play();
    const callsBeforeSpeedChange = engine.speakCalls.length;

    controller.setSpeed(2);
    expect(engine.cancelCallCount).toBeGreaterThan(0);
    expect(engine.speakCalls.length).toBeGreaterThan(callsBeforeSpeedChange);
    expect(engine.lastSpeak!.opts.rate).toBe(2);

    controller.pause();
    const callsWhilePaused = engine.speakCalls.length;
    controller.setSpeed(0.75);
    expect(engine.speakCalls).toHaveLength(callsWhilePaused); // no speak while paused
  });
});
