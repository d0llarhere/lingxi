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
  // Whether the OS/browser can synthesize this voice without a network
  // round-trip. Matters for an offline-first app: a `localService: false`
  // voice (e.g. Chrome's "Google network" voices) won't work without
  // connectivity, even though it appears in the same list as local voices.
  localService: boolean;
  // Whether this is the platform's default voice for its language.
  default: boolean;
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
  // Optional hint: the text of the sentences PlaybackController will speak
  // immediately after this one, nearest first, if any. Engines that must
  // render a whole utterance before any of it can play (e.g. Kokoro's ONNX
  // inference) may use this to start preparing those utterances while the
  // current one is still playing, instead of only starting once onEnd fires
  // — otherwise every sentence boundary is a multi-second silent gap. More
  // than one sentence of lookahead matters when a single sentence's
  // generation time exceeds its own playback time: with only one sentence of
  // buffer, generation can never get ahead of playback and every boundary
  // stalls again regardless. Purely an optimization hint: engines that
  // ignore it (e.g. WebSpeechTTSEngine, which has no such generation
  // latency) behave exactly as before.
  lookaheadTexts?: string[];
}

export interface TTSEngine {
  speak(text: string, opts: SpeakOptions): void;
  cancel(): void;
  listVoices(): Promise<VoiceInfo[]>;
}
