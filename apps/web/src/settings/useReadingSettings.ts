import { useEffect, useState } from 'react';

export type LineSpacing = 'tight' | 'normal' | 'loose';
export type TextWidth = 'narrow' | 'medium' | 'wide';
export type ParagraphSpacing = 'small' | 'medium' | 'large';
export type Alignment = 'left' | 'justified';
export type ReadingFontFamily = 'serif' | 'sans' | 'easy-read';
export type HighlightMode = 'sentence-word' | 'sentence' | 'off';

export interface ReadingSettings {
  fontSizePx: number;
  lineSpacing: LineSpacing;
  textWidth: TextWidth;
  paragraphSpacing: ParagraphSpacing;
  alignment: Alignment;
  fontFamily: ReadingFontFamily;
  highlightMode: HighlightMode;
  autoScroll: boolean;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontSizePx: 20,
  lineSpacing: 'normal',
  textWidth: 'medium',
  paragraphSpacing: 'medium',
  alignment: 'left',
  fontFamily: 'serif',
  highlightMode: 'sentence-word',
  autoScroll: true,
};

const STORAGE_KEY = 'lingxi-reading-settings';

const LINE_HEIGHT_BY_SPACING: Record<LineSpacing, number> = { tight: 1.5, normal: 1.8, loose: 2.1 };
const MAX_WIDTH_PX_BY_TEXT_WIDTH: Record<TextWidth, number> = { narrow: 560, medium: 680, wide: 820 };
const PARAGRAPH_SPACING_EM: Record<ParagraphSpacing, number> = { small: 0.6, medium: 1, large: 1.6 };
const FONT_FAMILY_STACK: Record<ReadingFontFamily, string> = {
  serif: 'var(--font-reading-serif)',
  sans: 'var(--font-ui)',
  'easy-read': '"Atkinson Hyperlegible", sans-serif',
};

export function readReadingSettings(): ReadingSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_READING_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingSettings>;
    return { ...DEFAULT_READING_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_READING_SETTINGS;
  }
}

// Applied as CSS custom properties on the document root (same technique
// useTheme.ts uses) so the reader picks up every change live, with no
// reload — the brief's own instruction. --reading-font-size/-line-height/
// -max-width already existed as static tokens.css defaults; this hook now
// owns their values. --reading-paragraph-spacing/-text-align are new
// (see reader.css's .reading-paragraph/.reading-column).
function applyReadingSettings(settings: ReadingSettings) {
  const root = document.documentElement.style;
  root.setProperty('--reading-font-size', `${settings.fontSizePx}px`);
  root.setProperty('--reading-line-height', String(LINE_HEIGHT_BY_SPACING[settings.lineSpacing]));
  root.setProperty('--reading-max-width', `${MAX_WIDTH_PX_BY_TEXT_WIDTH[settings.textWidth]}px`);
  root.setProperty('--reading-paragraph-spacing', `${PARAGRAPH_SPACING_EM[settings.paragraphSpacing]}em`);
  root.setProperty('--reading-text-align', settings.alignment === 'justified' ? 'justify' : 'left');
  root.setProperty('--font-reading', FONT_FAMILY_STACK[settings.fontFamily]);
}

export function useReadingSettings(): {
  settings: ReadingSettings;
  setSettings: (settings: ReadingSettings) => void;
} {
  const [settings, setSettingsState] = useState<ReadingSettings>(() => readReadingSettings());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applyReadingSettings(settings);
  }, [settings]);

  const setSettings = (next: ReadingSettings) => setSettingsState(next);

  return { settings, setSettings };
}
