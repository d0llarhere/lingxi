import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'sepia' | 'system';
export type ResolvedTheme = 'light' | 'dark' | 'sepia';

const STORAGE_KEY = 'lingxi-theme';

function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'sepia' ? stored : 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// The *true* current resolved theme, read directly from the DOM/OS rather
// than any one useTheme() instance's React state — there's no shared store
// behind this hook, so a second instance's state can lag behind a change
// made through a different one (e.g. the header's ThemeToggle vs the
// Appearance page). useAccentColor.ts/useReduceMotion.ts both need to react
// to a theme change regardless of which component made it, so they read
// this directly (via a MutationObserver) instead of taking `resolved` as a
// prop from one particular useTheme() call.
export function resolveCurrentTheme(): ResolvedTheme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark' || attr === 'sepia') return attr;
  return systemPrefersDark() ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

// Persists the user's explicit choice; 'system' defers to the OS via the
// prefers-color-scheme media query already wired into tokens.css.
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  toggle: () => void;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  useEffect(() => {
    applyTheme(preference);
    if (preference === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  }, [preference]);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // The header's sun/moon toggle stays binary — it can't represent a third
  // (sepia) state. Cycles light<->dark; if currently on sepia, moves to
  // dark, a single consistent fallback. Sepia itself is only reachable from
  // the Appearance page's own theme card.
  const toggle = useCallback(() => {
    setPreference((current) => {
      const currentResolved = current === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : current;
      if (currentResolved === 'sepia') return 'dark';
      return currentResolved === 'dark' ? 'light' : 'dark';
    });
  }, []);

  return { preference, resolved, toggle, setPreference };
}
