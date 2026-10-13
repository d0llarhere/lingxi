import { useEffect, useState } from 'react';

// Pure UI state — no playback involvement. The pill auto-collapses after 3s
// of playback with no pointer movement, or immediately while the user
// scrolls; pointer movement, focus, a keydown (shortcuts included), or a tap
// expands it again. Only collapses while `active` (the brief: "After 3s of
// playback..." — paused/idle always stay expanded, enforced by the caller
// passing `active = state === 'playing'`).
const IDLE_MS = 3000;

export function useAutoCollapse(active: boolean): boolean {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setCollapsed(false);
      return;
    }

    let idleTimer: ReturnType<typeof setTimeout>;
    const scheduleCollapse = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setCollapsed(true), IDLE_MS);
    };
    const expand = () => {
      setCollapsed(false);
      scheduleCollapse();
    };
    const handleScroll = () => {
      setCollapsed(true);
      scheduleCollapse();
    };

    window.addEventListener('pointermove', expand);
    window.addEventListener('keydown', expand);
    window.addEventListener('focus', expand, true);
    window.addEventListener('scroll', handleScroll, true);
    scheduleCollapse();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('pointermove', expand);
      window.removeEventListener('keydown', expand);
      window.removeEventListener('focus', expand, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [active]);

  return collapsed;
}
