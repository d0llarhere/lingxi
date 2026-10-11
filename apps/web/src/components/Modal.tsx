import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}

export function Modal({ title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    const firstField = panelRef.current?.querySelector<HTMLElement>('input, textarea, button');
    firstField?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel card" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close dialog">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
