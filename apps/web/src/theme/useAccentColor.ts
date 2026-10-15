import { useEffect, useState } from 'react';
import { darkenForContrast, pickOnColor, shiftLightness } from './colorMath';
import { resolveCurrentTheme, type ResolvedTheme } from './useTheme';

export interface AccentSwatch {
  id: string;
  label: string;
  hex: string;
}

// Hex values are the *dark*-theme anchor for each swatch — already pale,
// dark-surface-friendly tones. Light theme derives its own darker variant
// from the same hue (see applyAccent below).
export const ACCENT_SWATCHES: AccentSwatch[] = [
  { id: 'jade', label: 'Jade', hex: '#7cc4a8' },
  { id: 'sky', label: 'Sky', hex: '#8fb4e8' },
  { id: 'amber', label: 'Amber', hex: '#e8c98a' },
  { id: 'rose', label: 'Rose', hex: '#e8a3b0' },
  { id: 'lavender', label: 'Lavender', hex: '#c3b4f0' },
];

// Sepia's accent is intrinsic to that theme's own token set (paper/ink/
// accent, per the brief) rather than user-selectable via the swatch picker
// — a bright Jade/Sky/Rose would clash with the muted paper palette.
const SEPIA_ACCENT = '#8a6a3b';

const STORAGE_KEY = 'lingxi-accent';
const DEFAULT_ACCENT_ID = 'jade';

export function readAccentId(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return ACCENT_SWATCHES.some((s) => s.id === stored) ? (stored as string) : DEFAULT_ACCENT_ID;
}

function applyAccent(accentId: string, resolvedTheme: ResolvedTheme) {
  const swatch = ACCENT_SWATCHES.find((s) => s.id === accentId) ?? ACCENT_SWATCHES[0]!;
  const base =
    resolvedTheme === 'sepia'
      ? SEPIA_ACCENT
      : resolvedTheme === 'light'
        ? darkenForContrast(swatch.hex, '#ffffff', 4.5)
        : swatch.hex;
  const onAccent = pickOnColor(base);

  const root = document.documentElement.style;
  root.setProperty('--accent', base);
  root.setProperty('--accent-hover', shiftLightness(base, resolvedTheme === 'light' ? -0.08 : 0.08));
  root.setProperty('--accent-contrast', onAccent);
  root.setProperty('--on-accent', onAccent);
  // A real alpha blend (not a per-theme hand-picked solid), so it composites
  // correctly against whatever surface it's painted on in any theme.
  root.setProperty('--accent-soft', `color-mix(in srgb, ${base} 20%, transparent)`);
}

// No shared store behind either useTheme() or this hook, so two mounted
// instances (one kept alive app-wide for the side effect — see App.tsx —
// and one rendered by the Appearance page itself) need a way to notice a
// change made through the *other* instance. A small module-level
// subscriber list does that for the accent id itself; resolveCurrentTheme()
// + a MutationObserver does the same for theme changes, same technique
// useReduceMotion.ts uses.
type AccentListener = (accentId: string) => void;
let currentAccentId = readAccentId();
const listeners = new Set<AccentListener>();

function setAccentIdGlobal(id: string) {
  currentAccentId = id;
  localStorage.setItem(STORAGE_KEY, id);
  for (const listener of listeners) listener(id);
}

export function useAccentColor(): { accentId: string; setAccentId: (id: string) => void } {
  const [accentId, setAccentId] = useState(currentAccentId);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveCurrentTheme());

  useEffect(() => {
    listeners.add(setAccentId);
    return () => {
      listeners.delete(setAccentId);
    };
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setResolvedTheme(resolveCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolvedTheme(resolveCurrentTheme());
    mql.addEventListener('change', handler);
    return () => {
      observer.disconnect();
      mql.removeEventListener('change', handler);
    };
  }, []);

  useEffect(() => {
    applyAccent(accentId, resolvedTheme);
  }, [accentId, resolvedTheme]);

  return { accentId, setAccentId: setAccentIdGlobal };
}
