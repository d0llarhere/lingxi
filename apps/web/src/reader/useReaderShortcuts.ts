import { useEffect } from 'react';

interface ShortcutHandlers {
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSpeedDown: () => void;
  onSpeedUp: () => void;
  // Called instead of onEscape whenever the pill menu is open — the menu
  // owns closing itself (see PlaybackMenu.tsx's own Esc listener), but that
  // listener is scoped to the menu's DOM subtree; this flag stops the
  // document-level handler below from *also* firing onEscape (navigating
  // back to the library) for the same keypress.
  isMenuOpen: boolean;
  onEscape: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// Space -> play/pause, Left/Right -> previous/next paragraph, [/] -> speed
// ∓0.25, Esc -> handler (e.g. close an overlay or step back). Never fires
// while the user is typing into a form field.
export function useReaderShortcuts({ onPlayPause, onPrevious, onNext, onSpeedDown, onSpeedUp, isMenuOpen, onEscape }: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          onPlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onPrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNext();
          break;
        case '[':
          e.preventDefault();
          onSpeedDown();
          break;
        case ']':
          e.preventDefault();
          onSpeedUp();
          break;
        case 'Escape':
          if (!isMenuOpen) onEscape();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onPlayPause, onPrevious, onNext, onSpeedDown, onSpeedUp, isMenuOpen, onEscape]);
}
