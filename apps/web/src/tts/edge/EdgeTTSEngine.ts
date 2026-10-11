import type { SpeakOptions, TTSEngine, VoiceInfo, WordAnchor } from '@lingxi/core';
import { playAudioSegment, type AudioPlaybackHandle } from '../playAudioSegment';

// The only Edge voice Lingxi exposes. As with Kokoro, the full ~300-voice
// Edge catalog is never fetched or shown — just this one curated voice.
// Unlike every other voice in the app, this one requires internet: it talks
// to Microsoft's online neural TTS service, not anything running on-device
// (see ARCHITECTURE.md's offline-first goal — this is a deliberate, opt-in
// exception, never the default voice).
export const EDGE_VOICES: VoiceInfo[] = [
  { voiceURI: 'edge:en-US-AriaNeural', name: 'Aria', lang: 'en-US', localService: false, default: false },
];

export const EDGE_VOICE_PREFIX = 'edge:';

// A direct browser WebSocket to Microsoft's endpoint can't work (verified
// empirically — see ARCHITECTURE.md's "Aria voice" exception): the endpoint
// checks the connecting Origin, which no page JS in any browser can
// override. apps/tts-proxy is the server-side proxy that makes this voice
// reachable at all. Deployed on Render (not Cloudflare Workers — Microsoft
// blocks/rate-limits Workers' egress IP ranges specifically, confirmed
// empirically). Set VITE_TTS_PROXY_URL to override with a different
// deployment if needed.
const DEFAULT_PROXY_URL = 'https://lingxi-tts-proxy.onrender.com';
const PROXY_URL = (import.meta.env.VITE_TTS_PROXY_URL as string | undefined) || DEFAULT_PROXY_URL;

// Render's free tier sleeps the service after ~15min idle; the first request
// after that takes 30-50s to wake before it even starts processing, on top
// of normal synthesis time. REQUEST_TIMEOUT_MS has to comfortably cover the
// worst case of both, or every cold start would time out by design.
const REQUEST_TIMEOUT_MS = 70000;
// How long a request has to be pending before it's treated as "probably a
// cold start" rather than just normal network/synthesis latency, for the
// ariaWakeStatus signal below. A warm request completes in a few seconds at
// most; anything still pending past this is almost certainly Render waking
// up, not an unusually slow normal response.
const WAKE_UP_THRESHOLD_MS = 4000;

export type AriaWakeStatus = 'idle' | 'waking';
type WakeStatusListener = (status: AriaWakeStatus) => void;

// Lets the UI show "Waking up Aria…" instead of a request that just looks
// hung — same lightweight subscribe() shape as KokoroStatusSnapshot/
// OfflineDownloadSnapshot, scaled down since this is a single boolean-ish
// signal rather than a multi-state progress machine.
class AriaWakeTracker {
  private status: AriaWakeStatus = 'idle';
  private listeners = new Set<WakeStatusListener>();

  getStatus(): AriaWakeStatus {
    return this.status;
  }

  subscribe(listener: WakeStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  setStatus(status: AriaWakeStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}

export const ariaWakeTracker = new AriaWakeTracker();

export interface FetchedAudio {
  blob: Blob;
  words: WordAnchor[];
  durationMs: number;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Talks to apps/tts-proxy (not Microsoft directly — see above), which
// returns a complete MP3 + real word-boundary timing for the whole utterance
// with a single POST. Implements the same TTSEngine contract as
// WebSpeechTTSEngine/KokoroTTSEngine so PlaybackController needs no changes
// (see ARCHITECTURE.md §7/§8).
export class EdgeTTSEngine implements TTSEngine {
  private activeHandle: AudioPlaybackHandle | null = null;
  private audioContext: AudioContext | null = null;
  private activeToken = 0;

  speak(text: string, opts: SpeakOptions): void {
    this.cancel();
    const token = ++this.activeToken;
    const voiceId = voiceIdFromURI(opts.voiceURI);

    this.run(text, voiceId, opts, token).catch((error: unknown) => {
      if (token !== this.activeToken) return; // superseded by cancel()/a newer speak()
      opts.onError(error);
    });
  }

  // Network call only, no playback — the one artifact both normal speak()
  // and the segment cache (CachingTTSEngine, offline-download) need.
  async fetchAudio(text: string, voiceId: string, rate: number): Promise<FetchedAudio> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const wakeHandle = setTimeout(() => ariaWakeTracker.setStatus('waking'), WAKE_UP_THRESHOLD_MS);

    let response: Response;
    try {
      response = await fetch(`${PROXY_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceId, rate }),
        signal: controller.signal,
      });
    } catch (error) {
      throw controller.signal.aborted ? new Error('Edge TTS proxy request timed out.') : error;
    } finally {
      clearTimeout(timeoutHandle);
      clearTimeout(wakeHandle);
      ariaWakeTracker.setStatus('idle');
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Edge TTS proxy returned ${response.status}.`);
    }

    const json = (await response.json()) as { audio: string; words: WordAnchor[]; durationMs: number };
    // Cast needed because lib.dom's BlobPart expects ArrayBuffer-backed
    // views; Uint8Array's type param is the looser ArrayBufferLike. Safe at
    // runtime — Blob has always accepted any Uint8Array.
    const blob = new Blob([base64ToBytes(json.audio) as unknown as BlobPart], { type: 'audio/mpeg' });

    // The proxy's durationMs is derived from the last word's end — it
    // undershoots real audio length by however much trailing silence the
    // service adds (measured ~800ms in testing). A real decode is cheap and
    // exact, and the segment cache's SRT export needs accurate per-segment
    // duration to avoid timestamp drift once segments are concatenated.
    const durationMs = await this.measureDurationMs(blob).catch(() => json.durationMs);

    return { blob, words: json.words, durationMs };
  }

  private async measureDurationMs(blob: Blob): Promise<number> {
    const ctx = this.ensureAudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return audioBuffer.duration * 1000;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) this.audioContext = new AudioContext();
    return this.audioContext;
  }

  private async run(text: string, voiceId: string, opts: SpeakOptions, token: number): Promise<void> {
    const { blob, words } = await this.fetchAudio(text, voiceId, opts.rate);
    if (token !== this.activeToken) return;

    this.activeHandle = playAudioSegment(blob, text, words, {
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

  cancel(): void {
    this.activeToken++; // invalidates any in-flight run()
    this.activeHandle?.cancel();
    this.activeHandle = null;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return EDGE_VOICES;
  }
}

function voiceIdFromURI(voiceURI: string | null): string {
  if (voiceURI?.startsWith(EDGE_VOICE_PREFIX)) return voiceURI.slice(EDGE_VOICE_PREFIX.length);
  return 'en-US-AriaNeural';
}
