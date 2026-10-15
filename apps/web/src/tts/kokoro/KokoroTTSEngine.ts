import type { SpeakOptions, TTSEngine, VoiceInfo } from '@lingxi/core';
import KokoroWorker from './kokoro.worker?worker';
import type { KokoroVoiceId } from './kokoro.worker';

// The ONLY two local voices Lingxi exposes. Kokoro ships 40+ voices, but
// distributing a "choose from 40 voices" picker was explicitly rejected — the
// full list is never fetched or shown; only these two voice files are ever
// downloaded (see kokoro.worker.ts's download handler).
export const KOKORO_VOICES: VoiceInfo[] = [
  { voiceURI: 'kokoro:af_bella', name: 'Bella', lang: 'en-US', localService: true, default: false },
  { voiceURI: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', localService: true, default: false },
];

export const KOKORO_VOICE_PREFIX = 'kokoro:';

export type KokoroModelStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error';

export interface KokoroStatusSnapshot {
  status: KokoroModelStatus;
  progress: number;
  error: string | null;
}

type StatusListener = (snapshot: KokoroStatusSnapshot) => void;

// Once from_pretrained() + both voices have resolved successfully, the
// browser's own Cache Storage (used internally by transformers.js) is what
// actually avoids re-downloading — this flag only gates whether the UI is
// allowed to assume that's true without the user explicitly asking to
// download, so opening the reader never silently kicks off a ~93MB fetch.
const MODEL_READY_KEY = 'lingxi-kokoro-model-ready';
const TICK_MS = 100;

function readPersistedReady(): boolean {
  try {
    return localStorage.getItem(MODEL_READY_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistReady(ready: boolean): void {
  try {
    if (ready) localStorage.setItem(MODEL_READY_KEY, 'true');
    else localStorage.removeItem(MODEL_READY_KEY);
  } catch {
    // Non-fatal: worst case, the user is asked to press "Download" again
    // next session even though the browser cache still has the files.
  }
}

interface WorkerMessage {
  type: 'download-progress' | 'download-complete' | 'download-error' | 'result' | 'error';
  requestId?: number;
  progress?: number;
  message?: string;
  sampleRate?: number;
  audioBuffer?: ArrayBuffer;
}

export interface GeneratedAudio {
  audioBuffer: ArrayBuffer;
  sampleRate: number;
}

interface PendingRequest {
  resolve: (result: GeneratedAudio) => void;
  reject: (error: Error) => void;
}

interface Prefetch {
  text: string;
  voice: KokoroVoiceId;
  speed: number;
  requestId: number;
  promise: Promise<GeneratedAudio>;
}

// Implements the same TTSEngine contract as WebSpeechTTSEngine so
// PlaybackController needs no changes at all (see ARCHITECTURE.md §7/§8).
// Generation happens in a Worker (kokoro.worker.ts); this class owns Web
// Audio playback of the resulting buffer and emits estimated word-boundary
// ticks the same way WebSpeechTTSEngine's estimator does for voices without
// real boundary events — except here the *exact* audio duration is known up
// front (Kokoro returns a complete buffer, not a live stream), so the
// estimate is inherently more accurate than a guessed chars/sec rate.
//
// LOOK-AHEAD: measured on real book text, WASM inference for one sentence
// can take several seconds — with no overlap, that means several seconds of
// dead silence at *every* sentence boundary while the next sentence
// generates (confirmed directly: gaps up to ~6.5s on the test PDF). Instead,
// as soon as speak() starts the current sentence, it also fires off
// generation for opts.lookaheadTexts (the next few sentences, supplied by
// PlaybackController — see LOOKAHEAD_SENTENCE_COUNT) in the background. The
// worker processes requests strictly in the order received (see
// kokoro.worker.ts's queue), so the current sentence still generates first,
// but the following ones start generating immediately after — overlapping
// with this sentence's *playback* time instead of waiting for it to end.
// A single sentence of lookahead isn't enough: if one sentence's generation
// time exceeds its own playback time, a one-deep buffer can never get
// ahead, so every boundary stalls again regardless of how early the
// lookahead started. Buffering multiple sentences ahead gives slow
// sentences more runway to finish before playback catches up to them.
export class KokoroTTSEngine implements TTSEngine {
  private worker: Worker;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private tickHandle: number | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private activeRequestId: number | null = null;
  // Ordered nearest-first: prefetchQueue[0] is the sentence expected to play
  // next, prefetchQueue[1] the one after, etc. (see LOOK-AHEAD above).
  private prefetchQueue: Prefetch[] = [];

  private status: KokoroModelStatus = readPersistedReady() ? 'ready' : 'not-downloaded';
  private progress = 0;
  private error: string | null = null;
  private listeners = new Set<StatusListener>();

  constructor() {
    this.worker = new KokoroWorker();
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleWorkerMessage(event.data);
  }

  getStatusSnapshot(): KokoroStatusSnapshot {
    return { status: this.status, progress: this.progress, error: this.error };
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatusSnapshot());
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: KokoroModelStatus, progress = this.progress, error: string | null = null): void {
    this.status = status;
    this.progress = progress;
    this.error = error;
    for (const listener of this.listeners) listener(this.getStatusSnapshot());
  }

  // Explicit, user-initiated download — never triggered automatically by
  // speak(), so selecting a Kokoro voice never silently starts a ~93MB
  // background fetch. Downloads the model plus both of Lingxi's voices so
  // "Downloaded" is accurate for either one the user later picks.
  download(): void {
    if (this.status === 'downloading') return;
    this.setStatus('downloading', 0, null);
    this.worker.postMessage({ type: 'download' });
  }

  // Settings→Storage's "Voice model → Remove". transformers.js caches the
  // model via the browser's Cache Storage API under this exact bucket name
  // (confirmed by reading the installed @huggingface/transformers package —
  // `caches.open('transformers-cache')`); deleting it plus the local
  // "ready" flag is the only way to reclaim that space, since there's no
  // transformers.js API for it. A worker that's already loaded the model
  // into memory keeps working until the page reloads — this only prevents
  // it from being considered "ready" (and from being read from cache)
  // going forward, it doesn't abort anything in-flight.
  async remove(): Promise<void> {
    if ('caches' in window) {
      await caches.delete('transformers-cache').catch(() => {
        // Best-effort: if Cache Storage isn't available or the delete
        // fails, the model-ready flag still gets cleared below, which is
        // the part that actually controls whether the UI offers "Get"
        // again — worst case here is some bytes aren't reclaimed.
      });
    }
    persistReady(false);
    this.setStatus('not-downloaded', 0, null);
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    if (msg.type === 'download-progress') {
      this.setStatus('downloading', msg.progress ?? this.progress, null);
      return;
    }
    if (msg.type === 'download-complete') {
      persistReady(true);
      this.setStatus('ready', 1, null);
      return;
    }
    if (msg.type === 'download-error') {
      persistReady(false);
      this.setStatus('error', 0, msg.message ?? 'Download failed');
      return;
    }

    if (msg.requestId === undefined) return;
    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return; // cancelled/superseded — no one is waiting on this anymore
    this.pendingRequests.delete(msg.requestId);

    if (msg.type === 'result' && msg.audioBuffer && msg.sampleRate) {
      pending.resolve({ audioBuffer: msg.audioBuffer, sampleRate: msg.sampleRate });
    } else if (msg.type === 'error') {
      pending.reject(new Error(msg.message ?? 'Kokoro generation failed'));
    }
  }

  private requestGenerate(text: string, voice: KokoroVoiceId, speed: number): { requestId: number; promise: Promise<GeneratedAudio> } {
    const requestId = this.nextRequestId++;
    const promise = new Promise<GeneratedAudio>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
    });
    this.worker.postMessage({ type: 'generate', requestId, text, voice, speed });
    return { requestId, promise };
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) this.audioContext = new AudioContext();
    return this.audioContext;
  }

  // Generation only, no playback — reused by speak() below and by the
  // segment cache (CachingTTSEngine.ensureCached, offline-download), which
  // need the raw audio buffer without anything actually playing. Still
  // participates in the prefetch-queue dedup so cache-driven generation
  // reuses an in-flight look-ahead request when one happens to match. Note:
  // calling this while a live speak() session's own look-ahead is in
  // flight for a *different* text drops that queue (same as a seek/skip
  // would) — a background "download for offline" run started during active
  // playback can cause a brief redundant-generation stutter for the live
  // listener. Narrow edge case, not worth a separate queue for.
  async generateAudio(text: string, voice: KokoroVoiceId, speed: number): Promise<GeneratedAudio> {
    if (this.status !== 'ready') {
      throw new Error('Kokoro local voice model is not downloaded yet.');
    }
    const { promise } = this.resolveGenerateRequest(text, voice, speed);
    return promise;
  }

  private resolveGenerateRequest(
    text: string,
    voice: KokoroVoiceId,
    speed: number,
  ): { requestId: number; promise: Promise<GeneratedAudio> } {
    const front = this.prefetchQueue[0];
    if (front && front.text === text && front.voice === voice && front.speed === speed) {
      // An earlier sentence's look-ahead already covers this one.
      const { requestId, promise } = front;
      this.prefetchQueue.shift();
      return { requestId, promise };
    }
    // Not what was queued (a seek/skip, or the first sentence of
    // playback) — whatever was queued no longer reflects what's coming
    // next, so start clean rather than try to reconcile it. Must happen
    // before requestGenerate below, so this urgent request lands at the
    // front of the worker's queue instead of behind the abandoned entries.
    this.dropPrefetchQueue();
    return this.requestGenerate(text, voice, speed);
  }

  speak(text: string, opts: SpeakOptions): void {
    this.stopPlayback();
    this.activeRequestId = null;

    if (this.status !== 'ready') {
      opts.onError(new Error('Kokoro local voice model is not downloaded yet.'));
      return;
    }

    const voice = voiceIdFromURI(opts.voiceURI);
    const speed = opts.rate;
    const { requestId, promise } = this.resolveGenerateRequest(text, voice, speed);

    this.activeRequestId = requestId;
    promise.then(
      (result) => {
        if (this.activeRequestId !== requestId) return; // superseded by cancel()/a newer speak()
        this.playGenerated(result.audioBuffer, result.sampleRate, opts, text);
      },
      (error: Error) => {
        if (this.activeRequestId !== requestId) return;
        opts.onError(error);
      },
    );

    // Refill the queue to match opts.lookaheadTexts, reusing whatever's
    // already queued at each position and only issuing new generate
    // requests from the first position that doesn't already match —
    // everything from that point on in the old queue is for sentences that
    // are no longer coming up, so it's dropped.
    const desired = opts.lookaheadTexts ?? [];
    for (let i = 0; i < desired.length; i++) {
      const desiredText = desired[i] as string;
      const existing = this.prefetchQueue[i];
      if (existing && existing.text === desiredText && existing.voice === voice && existing.speed === speed) continue;
      this.prefetchQueue.length = i;
      const lookahead = this.requestGenerate(desiredText, voice, speed);
      // If this is ever discarded unused (pause/seek/stop before we get
      // there), nothing will observe its rejection otherwise.
      lookahead.promise.catch(() => {});
      this.prefetchQueue.push({ text: desiredText, voice, speed, ...lookahead });
    }
    if (this.prefetchQueue.length > desired.length) this.prefetchQueue.length = desired.length;
  }

  private playGenerated(audioData: ArrayBuffer, sampleRate: number, opts: SpeakOptions, text: string): void {
    const ctx = this.ensureAudioContext();
    void ctx.resume();

    const floatData = new Float32Array(audioData);
    const buffer = ctx.createBuffer(1, floatData.length, sampleRate);
    buffer.copyToChannel(floatData, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.sourceNode = source;

    const startTime = ctx.currentTime;
    const durationMs = buffer.duration * 1000;

    this.tickHandle = window.setInterval(() => {
      const elapsedMs = (ctx.currentTime - startTime) * 1000;
      const fraction = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 1;
      const charIndex = Math.floor(fraction * text.length);
      opts.onWordBoundary?.(charIndex, false);
      if (fraction >= 1) this.stopTick();
    }, TICK_MS);

    source.onended = () => {
      if (this.sourceNode !== source) return; // superseded by cancel()/a new speak()
      this.stopTick();
      this.sourceNode = null;
      opts.onEnd();
    };

    source.start();
  }

  private stopTick(): void {
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private stopPlayback(): void {
    this.stopTick();
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch {
        // Already stopped/ended — nothing to do.
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  cancel(): void {
    this.activeRequestId = null;
    this.stopPlayback();
    // Sentences that are no longer coming up next aren't worth keeping
    // prefetches for — simplest to drop them rather than track relevance.
    this.dropPrefetchQueue();
  }

  // Abandons every not-yet-consumed prefetch: tells the worker to drop
  // whatever's still queued (but not yet started — see kokoro.worker.ts's
  // reset-queue handling) so it doesn't block a soon-to-follow urgent
  // request, and forgets the corresponding pendingRequests entries so they
  // don't sit in the Map forever un-resolved (the worker will never message
  // about a request it just dropped from its queue; one still mid-generation
  // completes and is harmlessly ignored since its entry is already gone).
  private dropPrefetchQueue(): void {
    if (this.prefetchQueue.length === 0) return;
    for (const entry of this.prefetchQueue) this.pendingRequests.delete(entry.requestId);
    this.prefetchQueue = [];
    this.worker.postMessage({ type: 'reset-queue' });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return KOKORO_VOICES;
  }
}

export function voiceIdFromURI(voiceURI: string | null): KokoroVoiceId {
  if (voiceURI === 'kokoro:af_heart') return 'af_heart';
  return 'af_bella';
}
