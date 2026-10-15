import type { VoiceInfo } from '@lingxi/core';
import { useEffect, useState } from 'react';

export type SkipBy = 'sentence' | 'paragraph' | '15s';
export type ParagraphPause = 'none' | 'short' | 'long';
export type SleepTimerDefault = 'off' | 15 | 30 | 45 | 60 | 'end-of-chapter';

export interface ListeningDefaults {
  defaultVoiceURI: string | null;
  allowOnlineVoices: boolean;
  defaultSpeed: number;
  skipBy: SkipBy;
  paragraphPause: ParagraphPause;
  skipArtifacts: boolean;
  sleepTimerDefault: SleepTimerDefault;
  fadeOutAtEnd: boolean;
}

export const DEFAULT_LISTENING_DEFAULTS: ListeningDefaults = {
  defaultVoiceURI: null,
  allowOnlineVoices: true,
  defaultSpeed: 1,
  skipBy: 'paragraph',
  paragraphPause: 'short',
  skipArtifacts: true,
  sleepTimerDefault: 'off',
  fadeOutAtEnd: false,
};

export const PARAGRAPH_PAUSE_MS: Record<ParagraphPause, number> = { none: 0, short: 300, long: 800 };

const STORAGE_KEY = 'lingxi-listening-defaults';

export function readListeningDefaults(): ListeningDefaults {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_LISTENING_DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<ListeningDefaults>;
    return { ...DEFAULT_LISTENING_DEFAULTS, ...parsed };
  } catch {
    return DEFAULT_LISTENING_DEFAULTS;
  }
}

// Shared by the reader's voice list and the Listening tab's own voice
// picker — "Allow online voices" off hides edge:-prefixed voices from both.
export function filterVoicesByOnlinePolicy(voices: VoiceInfo[], allowOnlineVoices: boolean): VoiceInfo[] {
  if (allowOnlineVoices) return voices;
  // localService is the field every voice (Kokoro/Edge/WebSpeech alike)
  // already uses to mean "needs internet" — not just Edge's own voiceURI
  // prefix, since WebSpeech itself can also expose network-backed voices
  // (e.g. Chrome's "Google ... online" voices).
  return voices.filter((v) => v.localService);
}

export function useListeningDefaults(): {
  defaults: ListeningDefaults;
  setDefaults: (defaults: ListeningDefaults) => void;
} {
  const [defaults, setDefaultsState] = useState<ListeningDefaults>(() => readListeningDefaults());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  }, [defaults]);

  const setDefaults = (next: ListeningDefaults) => setDefaultsState(next);

  return { defaults, setDefaults };
}
