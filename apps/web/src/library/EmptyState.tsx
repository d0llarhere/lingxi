import { BookIcon, ClipboardIcon, UploadIcon } from '../components/icons';

interface EmptyStateProps {
  onImportPdf: () => void;
  onPasteText: () => void;
}

export function EmptyState({ onImportPdf, onPasteText }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <BookIcon />
      </span>
      <h2 className="empty-state-title">Your library is empty</h2>
      <p className="empty-state-body">Import a PDF or paste some text to start reading and listening.</p>
      <div className="empty-state-actions">
        <button type="button" className="btn btn-secondary" onClick={onImportPdf}>
          <UploadIcon />
          Import PDF
        </button>
        <button type="button" className="btn btn-primary" onClick={onPasteText}>
          <ClipboardIcon />
          Paste Text
        </button>
      </div>
    </div>
  );
}
