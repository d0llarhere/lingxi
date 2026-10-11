import type { SpeakOptions, TTSEngine, VoiceInfo } from '@lingxi/core';
import { CachingTTSEngine } from './CachingTTSEngine';
import { EDGE_VOICE_PREFIX, EDGE_VOICES, EdgeTTSEngine } from './edge/EdgeTTSEngine';
import { KOKORO_VOICE_PREFIX, KOKORO_VOICES, KokoroTTSEngine } from './kokoro/KokoroTTSEngine';
import { WebSpeechTTSEngine } from './WebSpeechTTSEngine';

// speechSynthesis is a browser-global singleton; one adapter instance per
// session is enough, and lets boundary-support detection (see
// WebSpeechTTSEngine) persist across documents rather than re-probing every
// time a document is opened.
export const webSpeechEngine = new WebSpeechTTSEngine();

// Owns the Worker that runs Kokoro inference — created once so the ~93MB
// model, once loaded, stays warm in the worker across documents instead of
// being reloaded every time the reader opens.
export const kokoroEngine = new KokoroTTSEngine();

// Owns the WebSocket connection to Microsoft's Edge TTS service — created
// once so the connection can be reused across sentences instead of
// reconnecting for every utterance.
export const edgeEngine = new EdgeTTSEngine();

function engineFor(voiceURI: string | null): TTSEngine {
  if (voiceURI?.startsWith(KOKORO_VOICE_PREFIX)) return kokoroEngine;
  if (voiceURI?.startsWith(EDGE_VOICE_PREFIX)) return edgeEngine;
  return webSpeechEngine;
}

// Routes speak()/cancel() to whichever backend the *selected voice* belongs
// to, decided purely from the voiceURI string (`kokoro:af_bella`, `edge:...`
// vs everything else, which is a Web Speech voiceURI or null for the browser
// default). This is the entire "clean abstraction" the three backends need:
// PlaybackController already treats voiceURI as an opaque string and never
// needs to know which engine is behind it.
class RoutingTTSEngine implements TTSEngine {
  speak(text: string, opts: SpeakOptions): void {
    const target = engineFor(opts.voiceURI);
    // Defensive cleanup: if the voice backend changed since the last
    // utterance, make sure the previous backend isn't left mid-utterance.
    for (const engine of [webSpeechEngine, kokoroEngine, edgeEngine]) {
      if (engine !== target) engine.cancel();
    }
    target.speak(text, opts);
  }

  cancel(): void {
    webSpeechEngine.cancel();
    kokoroEngine.cancel();
    edgeEngine.cancel();
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const webVoices = await webSpeechEngine.listVoices();
    return [...KOKORO_VOICES, ...EDGE_VOICES, ...webVoices];
  }
}

// Exported separately (typed, not just as the opaque TTSEngine below) so
// code that needs its cache-specific API — offline-download, export — can
// call ensureCached() directly rather than going through speak()/cancel().
export const cachingEngine = new CachingTTSEngine(new RoutingTTSEngine(), kokoroEngine, edgeEngine);

export const ttsEngine: TTSEngine = cachingEngine;
