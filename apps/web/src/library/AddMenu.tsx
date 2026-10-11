import { useEffect, useRef, useState } from 'react';
import { ClipboardIcon, PlusIcon, UploadIcon } from '../components/icons';

interface AddMenuProps {
  onImportPdf: () => void;
  onPasteText: () => void;
}

export function AddMenu({ onImportPdf, onPasteText }: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="menu-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="btn btn-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon />
        Add
      </button>
      {open && (
        <div className="menu-panel card" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onImportPdf();
            }}
          >
            <UploadIcon />
            Import PDF
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onPasteText();
            }}
          >
            <ClipboardIcon />
            Paste Text
          </button>
        </div>
      )}
    </div>
  );
}
