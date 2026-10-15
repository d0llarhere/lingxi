import { EDGE_VOICE_PREFIX } from './edge/EdgeTTSEngine';
import { KOKORO_VOICE_PREFIX } from './kokoro/KokoroTTSEngine';
import { edgeEngine, kokoroEngine, webSpeechEngine } from './ttsEngineInstance';

const PREVIEW_TEXT = 'This is a preview of this voice, reading at a normal pace.';

// A real, separate playback action (not a derived value) — see
// lingxi-redesign/REDESIGN_BRIEF.md's decision notes. Module-level (not a
// per-component ref) since there's only ever one voice preview playing
// app-wide, the same way kokoroEngine/edgeEngine are module-level
// singletons. Shared by the reader's pill menu and the Listening settings
// tab's own preview button — previously duplicated in ReaderScreen.tsx.
let activeEngine: { cancel: () => void } | null = null;

export function previewVoice(voiceURI: string): void {
  activeEngine?.cancel();

  const engine = voiceURI.startsWith(KOKORO_VOICE_PREFIX)
    ? kokoroEngine
    : voiceURI.startsWith(EDGE_VOICE_PREFIX)
      ? edgeEngine
      : webSpeechEngine;
  activeEngine = engine;
  engine.speak(PREVIEW_TEXT, {
    voiceURI,
    rate: 1,
    onWordBoundary: () => {},
    onEnd: () => {
      if (activeEngine === engine) activeEngine = null;
    },
    onError: () => {
      if (activeEngine === engine) activeEngine = null;
    },
  });
}
