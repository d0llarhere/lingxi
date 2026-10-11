// Pure helpers for the time-based TTS position estimator's self-calibration
// (see WebSpeechTTSEngine). Extracted so the math can be unit tested without
// a real SpeechSynthesis implementation.

// Converts an utterance's actual spoken duration into a chars/sec rate,
// normalized back to rate=1 so it can be reused at any future playback rate.
// Returns null for inputs that can't yield a meaningful measurement.
export function measureCharsPerSecond(textLength: number, actualMs: number, rate: number): number | null {
  if (textLength <= 0 || actualMs <= 0 || rate <= 0) return null;
  return textLength / (actualMs / 1000) / rate;
}

// Exponential moving average: blends a new measurement into the running
// estimate so a single outlier utterance can't swing the estimate wildly,
// while still letting it converge toward the real rate within a few
// utterances.
export function calibrateCharsPerSecond(previous: number, measured: number, smoothing: number): number {
  return previous * (1 - smoothing) + measured * smoothing;
}
