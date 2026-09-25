// The contract platform adapters implement (WebSpeechTTSEngine for web; a
// native Android adapter later). No implementation lives here — see
// ARCHITECTURE.md §7. Deliberately has no pause()/resume(): Web Speech API's
// pause/resume is unreliable across browsers, so PlaybackController never
// calls it — pausing is cancel() + persisting the cursor, resuming is a fresh
// speak() call from that cursor.

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface SpeakOptions {
  voiceURI: string | null;
  rate: number;
  // `confirmed` distinguishes a real engine-reported boundary from a
  // best-effort time-based estimate an adapter may produce when it has
  // determined word-boundary events aren't usable on this browser/voice (see
  // ARCHITECTURE.md §8). Only confirmed boundaries may advance the
  // persisted reading cursor — estimates are display-only.
  onWordBoundary?: (charIndexInText: number, confirmed: boolean) => void;
  onEnd: () => void;
  onError: (error: unknown) => void;
}

export interface TTSEngine {
  speak(text: string, opts: SpeakOptions): void;
  cancel(): void;
  listVoices(): Promise<VoiceInfo[]>;
}
