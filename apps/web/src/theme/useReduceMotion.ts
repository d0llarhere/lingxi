import { useEffect, useState } from 'react';

export type ReduceMotionPreference = 'system' | 'on' | 'off';

const STORAGE_KEY = 'lingxi-reduce-motion';

export function readReduceMotionPreference(): ReduceMotionPreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'on' || stored === 'off' ? stored : 'system';
}

function applyReduceMotion(preference: ReduceMotionPreference) {
  const root = document.documentElement.style;
  if (preference === 'on') {
    root.setProperty('--transition-fast', '0ms');
    root.setProperty('--transition-base', '0ms');
  } else if (preference === 'off') {
    root.setProperty('--transition-fast', '120ms');
    root.setProperty('--transition-base', '200ms');
  } else {
    // 'system': clear any inline override and let tokens.css's own
    // @media (prefers-reduced-motion: reduce) rule decide, same as before
    // this setting existed.
    root.removeProperty('--transition-fast');
    root.removeProperty('--transition-base');
  }
}

// Same cross-instance-sync reasoning as useAccentColor.ts — one instance
// stays mounted app-wide for the side effect (see App.tsx), another is
// rendered by the Appearance page itself.
type Listener = (preference: ReduceMotionPreference) => void;
let currentPreference = readReduceMotionPreference();
const listeners = new Set<Listener>();

function setPreferenceGlobal(preference: ReduceMotionPreference) {
  currentPreference = preference;
  localStorage.setItem(STORAGE_KEY, preference);
  for (const listener of listeners) listener(preference);
}

export function useReduceMotion(): { preference: ReduceMotionPreference; setPreference: (p: ReduceMotionPreference) => void } {
  const [preference, setPreference] = useState(currentPreference);

  useEffect(() => {
    listeners.add(setPreference);
    return () => {
      listeners.delete(setPreference);
    };
  }, []);

  useEffect(() => {
    applyReduceMotion(preference);
  }, [preference]);

  return { preference, setPreference: setPreferenceGlobal };
}
