import { useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';

interface RenameDialogProps {
  heading?: string;
  initialTitle: string;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}

export function RenameDialog({ heading = 'Rename document', initialTitle, onClose, onSubmit }: RenameDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(title.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={heading} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="field">
          <label className="field-label" htmlFor="rename-title">
            Title
          </label>
          <input
            id="rename-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || !title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
