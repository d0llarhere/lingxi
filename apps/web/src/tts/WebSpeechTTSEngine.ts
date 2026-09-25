import type { SpeakOptions, TTSEngine, VoiceInfo } from '@lingxi/core';

// Rough, tunable estimate used only when a browser/voice never fires
// SpeechSynthesisUtterance boundary events at all (see ARCHITECTURE.md §8).
const ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 = 15;
const ESTIMATOR_TICK_MS = 150;

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

  speak(text: string, opts: SpeakOptions): void {
    this.stopEstimator();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = opts.rate;

    const voice = opts.voiceURI ? speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI) : undefined;
    if (voice) utterance.voice = voice;

    let boundaryFiredThisUtterance = false;

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

    return voices
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang }));
  }

  private startEstimator(text: string, opts: SpeakOptions): void {
    const startTime = Date.now();
    const totalMs = (text.length / (ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 * (opts.rate || 1))) * 1000;

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
