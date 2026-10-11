// Runs Kokoro ONNX inference off the main thread. This is essential: the
// word-highlighting performance fix (see WordText.tsx) is only meaningful if
// nothing else blocks the UI thread either, and a q8-quantized 82M-parameter
// model doing WASM inference for a full sentence is a genuinely heavy
// synchronous computation — it must never run on the thread that also
// scrolls, highlights, and handles clicks.
import { KokoroTTS, env } from 'kokoro-js';

// transformers.js defaults ONNX Runtime's WASM binary to a jsdelivr CDN URL.
// That would silently reintroduce a network dependency into what's meant to
// be fully offline-after-download TTS. onnxruntime-web's package.json
// `exports` map doesn't expose its dist/*.wasm files as importable
// specifiers (a direct `?url` import is rejected by Rollup), so instead the
// exact runtime files it needs — the plain and .jsep (WebGPU-capable)
// variants of ort-wasm-simd-threaded.{wasm,mjs}, ~32MB total, copied once
// from node_modules into apps/web/public/ort/ — are served as plain static
// assets, and wasmPaths is pointed at that local directory prefix. Both
// variants are present because the runtime dynamically imports the .jsep
// companion module even when device is forced to "wasm" (observed directly:
// omitting it fails with "Failed to fetch dynamically imported module").
// Either way, the WASM runtime itself never leaves the device after the
// app's own bundle has loaded once.
env.wasmPaths = '/ort/';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q8 (~92MB) balances quality against download size — fp32 is 326MB and q4
// is barely smaller than fp32 for this model, while q8 is the size the
// library's own docs use as the standard example.
const DTYPE = 'q8';

export type KokoroVoiceId = 'af_bella' | 'af_heart';

interface DownloadRequest {
  type: 'download';
}

interface GenerateRequest {
  type: 'generate';
  requestId: number;
  text: string;
  voice: KokoroVoiceId;
  speed: number;
}

// Sent whenever the main thread abandons its whole look-ahead queue (a
// seek/skip/voice change, or cancel() with nothing queued to resume into —
// see KokoroTTSEngine). Drops any not-yet-started requests from
// generateQueue so a newly-urgent request (always enqueued right after this)
// doesn't get stuck behind look-ahead work for sentences that are no longer
// coming up next. Whatever's already mid-generation can't be interrupted —
// it finishes and its result is harmlessly ignored on the main thread, which
// has already forgotten the requestId.
interface ResetQueueRequest {
  type: 'reset-queue';
}

type WorkerRequest = DownloadRequest | GenerateRequest | ResetQueueRequest;

// `lib.dom` (used project-wide, for React/browser code) and `lib.webworker`
// declare incompatible globals and can't both be referenced in one TS
// program. `Worker`'s postMessage(message, transfer?) signature is identical
// in shape to a worker's own ctx.postMessage, so casting through it gets a
// correctly-typed call without pulling in lib.webworker at all.
const ctx = self as unknown as Worker;

interface ProgressAccumulator {
  [file: string]: { loaded: number; total: number };
}

let ttsPromise: Promise<KokoroTTS> | null = null;

// 'generate' requests are queued and run strictly one at a time. With
// multi-sentence look-ahead (see playbackController's LOOKAHEAD_SENTENCE_COUNT
// and KokoroTTSEngine's prefetchQueue), the main thread can post several
// generate requests back-to-back for the current sentence plus a couple
// ahead of it. Letting those race for the same WASM thread pool would be
// self-defeating — it'd slow down the urgent one (whatever's about to play)
// to the same degree it speeds up the later ones. A FIFO queue guarantees
// the most urgent request (always enqueued first, see KokoroTTSEngine.speak)
// gets the WASM runtime's full throughput before any look-ahead request
// starts.
const generateQueue: GenerateRequest[] = [];
let processingGenerateQueue = false;

async function runGenerateQueue(): Promise<void> {
  if (processingGenerateQueue) return;
  processingGenerateQueue = true;
  try {
    let request: GenerateRequest | undefined;
    while ((request = generateQueue.shift())) {
      const { requestId, text, voice, speed } = request;
      try {
        // No progress callback here: generate() is only ever called once the
        // main thread already believes the model is downloaded (see
        // KokoroTTSEngine.speak's status guard). The one real case this
        // still has to handle is a fresh worker after a page reload, whose
        // in-memory ttsPromise was lost even though the files are still in
        // Cache Storage — that's an invisible warm-up read from cache, not a
        // new download, so it must never flash a "Downloading…" status.
        const tts = await loadTTS(() => {});
        const rawAudio = await tts.generate(text, { voice, speed });
        const audioData = rawAudio.audio;
        ctx.postMessage(
          { type: 'result', requestId, sampleRate: rawAudio.sampling_rate, audioBuffer: audioData.buffer },
          [audioData.buffer],
        );
      } catch (error) {
        ctx.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    processingGenerateQueue = false;
  }
}

function loadTTS(onProgress: (overallProgress: number) => void): Promise<KokoroTTS> {
  if (!ttsPromise) {
    const files: ProgressAccumulator = {};
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      // null = let the library auto-detect: WebGPU when a real GPU adapter
      // is available (measured many times faster than WASM/CPU for ONNX
      // inference — important given generation must outrun real-time
      // playback, see look-ahead comment in KokoroTTSEngine.ts), falling
      // back to WASM otherwise. This sandbox's Chrome has no GPU adapter
      // (navigator.gpu.requestAdapter() resolves null) so it always falls
      // back to wasm here, but a real desktop browser with GPU access should
      // get the WebGPU path automatically.
      device: null,
      progress_callback: (info) => {
        if (info.status === 'progress') {
          files[info.file] = { loaded: info.loaded, total: info.total };
          let loaded = 0;
          let total = 0;
          for (const f of Object.values(files)) {
            loaded += f.loaded;
            total += f.total;
          }
          onProgress(total > 0 ? loaded / total : 0);
        }
      },
    }).catch((error) => {
      // A failed load must not be cached as "the" load attempt — the next
      // download click should retry from scratch, not immediately reject.
      ttsPromise = null;
      throw error;
    });
  }
  return ttsPromise;
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'download') {
    try {
      const tts = await loadTTS((progress) => {
        ctx.postMessage({ type: 'download-progress', progress });
      });
      // Voice data is fetched lazily per-voice on first use (kokoro-js
      // getVoiceData) — pre-fetch both of Lingxi's two voices now so
      // "Downloaded" means both Bella and Heart are actually ready, not just
      // whichever one happens to be generated first.
      await Promise.all([
        tts.generate('.', { voice: 'af_bella' }),
        tts.generate('.', { voice: 'af_heart' }),
      ]);
      ctx.postMessage({ type: 'download-complete' });
    } catch (error) {
      ctx.postMessage({ type: 'download-error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (msg.type === 'generate') {
    generateQueue.push(msg);
    void runGenerateQueue();
    return;
  }

  if (msg.type === 'reset-queue') {
    generateQueue.length = 0;
  }
};
