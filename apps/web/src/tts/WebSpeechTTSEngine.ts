import { calibrateCharsPerSecond, measureCharsPerSecond, type SpeakOptions, type TTSEngine, type VoiceInfo } from '@lingxi/core';

// Starting guess for chars-per-second at rate=1, used only when a
// browser/voice never fires SpeechSynthesisUtterance boundary events at all
// (see ARCHITECTURE.md §8). This is deliberately just a seed value, not a
// fixed constant: measuring real Google network voices showed actual speech
// rate is ~17-20 chars/sec, not a fixed number — it varies by voice and even
// by sentence. A static guess drifts increasingly out of sync over a long
// sentence (measured: ~15 vs a real ~17 compounds to ~1s of lag by the end of
// an 8s sentence). `calibratedCharsPerSecond` self-corrects from the actual
// measured duration of each completed utterance instead.
const INITIAL_CHARS_PER_SECOND_AT_RATE_1 = 17;
const ESTIMATOR_TICK_MS = 150;
// How much weight a new measurement gets vs. the running estimate.
const CALIBRATION_SMOOTHING = 0.5;

// Web Speech API implementation of the shared TTSEngine contract. Word
// boundary support genuinely varies across browsers and voices — this class
// detects it empirically (does *any* boundary event fire during the first
// utterance?) rather than assuming it. When boundary events are unsupported,
// it falls back to a time-based estimate for *display* purposes only; the
// `confirmed` flag on onWordBoundary tells PlaybackController never to
// persist an estimated position as the reading cursor.
export class WebSpeechTTSEngine implements TTSEngine {
  private boundarySupportKnown = false;
  private boundarySupported = false;
  private estimatorHandle: number | null = null;
  // Self-calibrating estimate of chars/sec at rate=1, refined from the
  // measured onstart→onend duration of each utterance actually spoken
  // through the estimator path. Starts at a seed value and converges toward
  // the real voice's rate within a couple of sentences.
  private calibratedCharsPerSecond = INITIAL_CHARS_PER_SECOND_AT_RATE_1;

  speak(text: string, opts: SpeakOptions): void {
    this.stopEstimator();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = opts.rate;

    const voice = opts.voiceURI ? speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI) : undefined;
    if (voice) utterance.voice = voice;

    let boundaryFiredThisUtterance = false;
    // Measured from onstart (when audio actually begins) rather than from
    // the speak() call, so queueing/engine-startup latency doesn't pollute
    // the calibration.
    let speechStartTime: number | null = null;

    utterance.onstart = () => {
      speechStartTime = performance.now();
    };

    utterance.onboundary = (event) => {
      boundaryFiredThisUtterance = true;
      if (!this.boundarySupportKnown || !this.boundarySupported) {
        this.boundarySupportKnown = true;
        this.boundarySupported = true;
        this.stopEstimator();
      }
      opts.onWordBoundary?.(event.charIndex, true);
    };

    utterance.onend = () => {
      this.stopEstimator();
      if (!this.boundarySupportKnown) {
        this.boundarySupportKnown = true;
        this.boundarySupported = boundaryFiredThisUtterance;
      }
      // Only utterances that finish normally (not cancelled — cancel()
      // fires onerror, never onend) give a trustworthy full-duration
      // measurement, and only the estimator path needs calibrating.
      if (!this.boundarySupported && speechStartTime !== null) {
        const actualMs = performance.now() - speechStartTime;
        const measured = measureCharsPerSecond(text.length, actualMs, opts.rate || 1);
        if (measured !== null) {
          this.calibratedCharsPerSecond = calibrateCharsPerSecond(
            this.calibratedCharsPerSecond,
            measured,
            CALIBRATION_SMOOTHING,
          );
        }
      }
      opts.onEnd();
    };

    utterance.onerror = (event) => {
      this.stopEstimator();
      opts.onError(event);
    };

    // Only start estimating once we already know real boundaries aren't
    // coming. The very first utterance in a session always gets a real
    // attempt first — there's no way to know support without trying.
    if (this.boundarySupportKnown && !this.boundarySupported) {
      this.startEstimator(text, opts);
    }

    speechSynthesis.speak(utterance);
  }

  cancel(): void {
    this.stopEstimator();
    speechSynthesis.cancel();
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const load = () => speechSynthesis.getVoices();
    let voices = load();

    if (voices.length === 0) {
      voices = await new Promise((resolve) => {
        const handle = () => {
          speechSynthesis.removeEventListener('voiceschanged', handle);
          resolve(load());
        };
        speechSynthesis.addEventListener('voiceschanged', handle);
        // Some browsers never fire voiceschanged; don't hang forever.
        setTimeout(() => {
          speechSynthesis.removeEventListener('voiceschanged', handle);
          resolve(load());
        }, 1000);
      });
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        '[TTS] speechSynthesis.getVoices() returned',
        voices.length,
        'voices:',
        voices.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService, default: v.default })),
      );
    }

    const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));

    // Some browsers (observed on Chrome/Linux across repeated voiceschanged
    // firings) can list the same underlying voice more than once. Dedupe by
    // voiceURI, which uniquely identifies a voice, so it doesn't appear twice
    // in the selector.
    const byURI = new Map<string, SpeechSynthesisVoice>();
    for (const v of englishVoices) {
      if (!byURI.has(v.voiceURI)) byURI.set(v.voiceURI, v);
    }

    return Array.from(byURI.values()).map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    }));
  }

  private startEstimator(text: string, opts: SpeakOptions): void {
    const startTime = Date.now();
    const totalMs = (text.length / (this.calibratedCharsPerSecond * (opts.rate || 1))) * 1000;

    this.estimatorHandle = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const fraction = totalMs > 0 ? Math.min(1, elapsed / totalMs) : 1;
      const estimatedCharIndex = Math.floor(fraction * text.length);
      opts.onWordBoundary?.(estimatedCharIndex, false);
      if (fraction >= 1) this.stopEstimator();
    }, ESTIMATOR_TICK_MS);
  }

  private stopEstimator(): void {
    if (this.estimatorHandle !== null) {
      window.clearInterval(this.estimatorHandle);
      this.estimatorHandle = null;
    }
  }
}
