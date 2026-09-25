import type { LingxiDocument } from '@lingxi/core';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLibrary } from './LibraryProvider';

interface LibraryScreenProps {
  onOpenDocument: (documentId: string) => void;
}

export function LibraryScreen({ onOpenDocument }: LibraryScreenProps) {
  const { repository, ready } = useLibrary();
  const [documents, setDocuments] = useState<LingxiDocument[]>([]);
  const [title, setTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [importingPdf, setImportingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!repository) return;
    setDocuments(await repository.listDocuments());
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!repository) return;
    if (!title.trim() || !pastedText.trim()) {
      setError('Title and text are both required.');
      return;
    }
    setError(null);
    await repository.createFromPastedText(title.trim(), pastedText);
    setTitle('');
    setPastedText('');
    await refresh();
  }

  async function handleImportPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!repository || !file) return;

    setImportingPdf(true);
    setError(null);
    try {
      await repository.createFromPdf(file);
      await refresh();
    } catch {
      setError('Could not read this PDF. It may be corrupted.');
    } finally {
      setImportingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    if (!repository) return;
    await repository.deleteDocument(id);
    await refresh();
  }

  function startRename(doc: LingxiDocument) {
    setRenamingId(doc.id);
    setRenameValue(doc.title);
  }

  async function commitRename(id: string) {
    if (!repository || !renameValue.trim()) return;
    await repository.rename(id, renameValue.trim());
    setRenamingId(null);
    await refresh();
  }

  if (!ready) {
    return <p>Loading library…</p>;
  }

  return (
    <section>
      <h1>Library</h1>

      <div>
        <h2>Import PDF</h2>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleImportPdf}
          disabled={importingPdf}
        />
        {importingPdf && <p>Importing…</p>}
      </div>

      <form onSubmit={handleAdd}>
        <h2>Add pasted text</h2>
        <div>
          <label htmlFor="new-doc-title">Title</label>
          <input id="new-doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-doc-text">Text</label>
          <textarea
            id="new-doc-text"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={6}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Add to library</button>
      </form>

      <h2>Documents</h2>
      {documents.length === 0 && <p>No documents yet.</p>}
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            {renamingId === doc.id ? (
              <>
                <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                <button onClick={() => commitRename(doc.id)}>Save</button>
                <button onClick={() => setRenamingId(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button onClick={() => onOpenDocument(doc.id)}>
                  {doc.title}
                  {doc.sourceType === 'pdf' ? ' (PDF)' : ''}
                </button>
                <button onClick={() => startRename(doc)}>Rename</button>
                <button onClick={() => handleDelete(doc.id)}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
