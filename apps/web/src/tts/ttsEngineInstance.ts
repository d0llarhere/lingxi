import { WebSpeechTTSEngine } from './WebSpeechTTSEngine';

// speechSynthesis is a browser-global singleton; one adapter instance per
// session is enough, and lets boundary-support detection (see
// WebSpeechTTSEngine) persist across documents rather than re-probing every
// time a document is opened.
export const ttsEngine = new WebSpeechTTSEngine();
