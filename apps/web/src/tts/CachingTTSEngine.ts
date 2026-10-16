import { hashText, type SegmentCacheRecord, type SpeakOptions, type TTSEngine, type VoiceInfo } from '@lingxi/core';
import { EDGE_VOICE_PREFIX, type EdgeTTSEngine } from './edge/EdgeTTSEngine';
import { KOKORO_VOICE_PREFIX, voiceIdFromURI, type KokoroTTSEngine } from './kokoro/KokoroTTSEngine';
import { playAudioSegment, type AudioPlaybackHandle } from './playAudioSegment';
import { getSegmentCacheRepository } from './segmentCacheInstance';
import { encodeWav } from './wavEncoder';

function isCacheableVoice(voiceURI: string | null): voiceURI is string {
  if (!voiceURI) return false;
  return voiceURI.startsWith(KOKORO_VOICE_PREFIX) || voiceURI.startsWith(EDGE_VOICE_PREFIX);
}

// Thrown by ensureCached (live-playback path only — see its `gateOffline`
// param) instead of attempting synthesis, when offline and the text isn't
// already cached. Deliberately thrown even for Kokoro, which *could*
// technically still synthesize locally while offline: "offline" is meant to
// mean "only what you downloaded," predictably, regardless of which engine
// the current voice happens to use — see
// docs/lingxi-part4/BRIEF_DOWNLOAD_RANGES.md ("pause and show a toast").
// ReaderScreen's onPersistError special-cases this type to show that toast.
export class OfflineCacheMissError extends Error {
  constructor() {
    super('This part of the book is not downloaded, and you are offline.');
    this.name = 'OfflineCacheMissError';
  }
}

// Wraps the existing routing engine with a content-addressed audio cache —
// implements the same TTSEngine contract (interface unchanged) so
// PlaybackController needs no changes. Only kokoro:/edge: voices are
// cacheable at all: WebSpeech's speechSynthesis exposes no audio stream to
// capture, so anything else is passed straight through to `inner`
// untouched, same behavior as before this class existed.
//
// Cache key is hash(text + voiceURI + rate), not any document/segment
// identity — see ARCHITECTURE.md's segment-cache section for why: engines
// only ever see `text` + SpeakOptions, so keying any other way would mean
// changing that shared contract.
export class CachingTTSEngine implements TTSEngine {
  private activeHandle: AudioPlaybackHandle | null = null;
  private activeToken = 0;

  constructor(
    private readonly inner: TTSEngine,
    private readonly kokoro: KokoroTTSEngine,
    private readonly edge: EdgeTTSEngine,
  ) {}

  speak(text: string, opts: SpeakOptions): void {
    this.cancel();

    if (!isCacheableVoice(opts.voiceURI)) {
      this.inner.speak(text, opts);
      return;
    }

    const token = ++this.activeToken;
    this.runCached(text, opts, opts.voiceURI, token).catch((error: unknown) => {
      if (token !== this.activeToken) return; // superseded by cancel()/a newer speak()
      opts.onError(error);
    });
  }

  private async runCached(text: string, opts: SpeakOptions, voiceURI: string, token: number): Promise<void> {
    const record = await this.ensureCached(text, voiceURI, opts.rate, { gateOffline: true });
    if (token !== this.activeToken) return;

    this.activeHandle = playAudioSegment(record.audioBlob, text, record.words, {
      ...opts,
      onEnd: () => {
        if (token !== this.activeToken) return;
        opts.onEnd();
      },
      onError: (error) => {
        if (token !== this.activeToken) return;
        opts.onError(error);
      },
    });
  }

  // Generate-and-cache without playing — the entry point offline-download
  // (and export, once a document is fully cached) uses to populate the
  // cache ahead of/independent from live playback. Also the cache-miss path
  // speak() itself falls through to.
  //
  // `gateOffline` is only ever set by the live-playback path (runCached) —
  // offline-download deliberately leaves it unset, so a Kokoro-based
  // download (local inference, no network needed) keeps working even while
  // offline; an Edge-based one still fails on its own, honestly, via a real
  // network error from fetchAudio.
  async ensureCached(text: string, voiceURI: string, rate: number, options?: { gateOffline?: boolean }): Promise<SegmentCacheRecord> {
    const key = await hashText([text, voiceURI, String(rate)]);
    const repo = await getSegmentCacheRepository();

    const existing = await repo.getSegment(key);
    if (existing) return existing;

    if (options?.gateOffline && !navigator.onLine) throw new OfflineCacheMissError();

    const record = await this.generate(text, voiceURI, rate, key);
    await repo.putSegment(record);
    return record;
  }

  private async generate(text: string, voiceURI: string, rate: number, key: string): Promise<SegmentCacheRecord> {
    const createdAt = Date.now();

    if (voiceURI.startsWith(KOKORO_VOICE_PREFIX)) {
      const voice = voiceIdFromURI(voiceURI);
      const { audioBuffer, sampleRate } = await this.kokoro.generateAudio(text, voice, rate);
      const samples = new Float32Array(audioBuffer);
      return {
        key,
        text,
        audioBlob: encodeWav(samples, sampleRate),
        words: [], // Kokoro has no real per-word timing, only estimated — see playAudioSegment
        engine: 'kokoro',
        durationMs: (samples.length / sampleRate) * 1000,
        createdAt,
      };
    }

    const voiceId = voiceURI.slice(EDGE_VOICE_PREFIX.length);
    const { blob, words, durationMs } = await this.edge.fetchAudio(text, voiceId, rate);
    return { key, text, audioBlob: blob, words, engine: 'edge', durationMs, createdAt };
  }

  cancel(): void {
    this.activeToken++; // invalidates any in-flight runCached()
    this.activeHandle?.cancel();
    this.activeHandle = null;
    // Always forward: stops whichever backend was actually mid-utterance
    // (WebSpeech for the non-cacheable path; a defensive no-op otherwise,
    // since an in-flight generate()/fetchAudio() isn't abortable and will
    // just resolve into a discarded, token-mismatched result).
    this.inner.cancel();
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return this.inner.listVoices();
  }
}
