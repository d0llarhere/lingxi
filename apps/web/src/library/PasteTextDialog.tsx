import { useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';

interface PasteTextDialogProps {
  onClose: () => void;
  onSubmit: (title: string, text: string) => Promise<void>;
}

export function PasteTextDialog({ onClose, onSubmit }: PasteTextDialogProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setError('Title and text are both required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(title.trim(), text);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Paste text" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="field">
          <label className="field-label" htmlFor="paste-title">
            Title
          </label>
          <input
            id="paste-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="paste-text">
            Text
          </label>
          <textarea
            id="paste-text"
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add to library'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
