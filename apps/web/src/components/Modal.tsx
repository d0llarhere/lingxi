import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface ModalProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  // Widens the panel beyond the default 480px (e.g. the download-range
  // dialog's 520px, which needs room for two side-by-side selects).
  wide?: boolean;
}

export function Modal({ title, subtitle, onClose, children, wide }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Focus trap: Tab/Shift+Tab cycles within the panel instead of
      // escaping to the page behind it.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const firstField = panelRef.current?.querySelector<HTMLElement>('input, textarea, button');
    firstField?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-panel card${wide ? ' modal-panel-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close dialog">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
