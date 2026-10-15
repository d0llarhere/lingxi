import { DEFAULT_CHAPTER_DETECTION, type ChapterDetectionSettings } from '@lingxi/core';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lingxi-chapter-detection';

function readStored(): ChapterDetectionSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CHAPTER_DETECTION;
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterDetectionSettings>;
    if (parsed.mode !== 'auto' && parsed.mode !== 'off' && parsed.mode !== 'custom') return DEFAULT_CHAPTER_DETECTION;
    return { mode: parsed.mode, customPrefix: typeof parsed.customPrefix === 'string' ? parsed.customPrefix : '' };
  } catch {
    return DEFAULT_CHAPTER_DETECTION;
  }
}

// App-wide preference (not per-document) for how detectChapters recognizes
// chapter headings — see lingxi-redesign's chapter-separation follow-up.
// Same localStorage-backed hook shape as useTheme.ts.
export function useChapterDetection(): {
  settings: ChapterDetectionSettings;
  setSettings: (settings: ChapterDetectionSettings) => void;
} {
  const [settings, setSettingsState] = useState<ChapterDetectionSettings>(() => readStored());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setSettings = useCallback((next: ChapterDetectionSettings) => setSettingsState(next), []);

  return { settings, setSettings };
}
