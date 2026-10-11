import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'lingxi-theme';

function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
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
export function useTheme(): { preference: ThemePreference; resolved: 'light' | 'dark'; toggle: () => void } {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

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
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;

  const toggle = useCallback(() => {
    setPreference((current) => {
      const currentResolved = current === 'system' ? (systemPrefersDark ? 'dark' : 'light') : current;
      return currentResolved === 'dark' ? 'light' : 'dark';
    });
  }, [systemPrefersDark]);

  return { preference, resolved, toggle };
}
