import { useEffect } from 'react';

interface ShortcutHandlers {
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onEscape: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// Space -> play/pause, Left/Right -> previous/next sentence, Esc -> handler
// (e.g. close an overlay or step back). Never fires while the user is typing
// into a form field.
export function useReaderShortcuts({ onPlayPause, onPrevious, onNext, onEscape }: ShortcutHandlers) {
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
        case 'Escape':
          onEscape();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onPlayPause, onPrevious, onNext, onEscape]);
}
