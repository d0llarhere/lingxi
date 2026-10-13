import { computeProgress, type LingxiDocument } from '@lingxi/core';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GridIcon, ListIcon, SearchIcon, UploadIcon } from '../components/icons';
import { ThemeToggle } from '../theme/ThemeToggle';
import { AddMenu } from './AddMenu';
import { DocumentCard, type DocumentCardData } from './DocumentCard';
import { EmptyState } from './EmptyState';
import { LibraryTable } from './LibraryTable';
import { useLibrary } from './LibraryProvider';
import { PasteTextDialog } from './PasteTextDialog';
import { RenameDialog } from './RenameDialog';
import { type NavKey, Sidebar } from './Sidebar';

type LibraryView = 'grid' | 'list';
const VIEW_STORAGE_KEY = 'lingxi-library-view';

interface LibraryScreenProps {
  onOpenDocument: (documentId: string, options?: { autoplay?: boolean }) => void;
  onNavigate: (nav: NavKey) => void;
}

export function LibraryScreen({ onOpenDocument, onNavigate }: LibraryScreenProps) {
  const { repository, ready } = useLibrary();
  const [cards, setCards] = useState<DocumentCardData[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importingPdf, setImportingPdf] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [renamingDoc, setRenamingDoc] = useState<LingxiDocument | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<LingxiDocument | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<LibraryView>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'grid' || stored === 'list' ? stored : 'list';
  });
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  function changeView(next: LibraryView) {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  async function refresh() {
    if (!repository) return;
    const docs = await repository.listDocuments();
    const data = await Promise.all(
      docs.map(async (doc): Promise<DocumentCardData> => {
        const cursor = await repository.getCursor(doc.id);
        const lastPage = doc.structure.pages.at(-1);
        const totalChars = lastPage ? lastPage.charEnd : 0;
        const progress = cursor ? computeProgress(cursor.charOffset, totalChars) : 0;
        const totalPages = doc.structure.pages.length;
        const currentPage = cursor && totalPages > 1 ? cursor.pageIndex + 1 : null;
        return { doc, progress, currentPage, totalPages, charOffset: cursor?.charOffset ?? 0, totalChars };
      }),
    );
    setCards(data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  async function handlePasteSubmit(title: string, text: string) {
    if (!repository) return;
    await repository.createFromPastedText(title, text);
    await refresh();
  }

  async function importPdfFile(file: File) {
    if (!repository) return;

    setImportingPdf(true);
    setError(null);
    try {
      await repository.createFromPdf(file);
    } catch (err) {
      // Logged so real extraction failures (encrypted/malformed PDFs, etc.)
      // are diagnosable instead of only ever showing the generic message.
      console.error('PDF import failed', err);
      setError('Could not read this PDF. It may be corrupted or password-protected.');
      setImportingPdf(false);
      return;
    }
    setImportingPdf(false);
    // Deliberately outside the above try/catch: a failure here is a library
    // refresh bug, not a PDF problem, and must not be reported as one.
    await refresh();
  }

  async function handleImportPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await importPdfFile(file);
    if (pdfInputRef.current) pdfInputRef.current.value = '';
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!repository || !file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'pdf') {
      await importPdfFile(file);
    } else if (extension === 'txt') {
      const text = await file.text();
      await repository.createFromPastedText(file.name.replace(/\.txt$/i, ''), text);
      await refresh();
    } else {
      // EPUB and anything else isn't supported by any extractor in this
      // codebase yet — same message an unreadable PDF would show, rather
      // than failing silently.
      setError('Could not import this file. Drop a PDF or .txt file.');
    }
  }

  async function handleConfirmDelete() {
    if (!repository || !deletingDoc) return;
    await repository.deleteDocument(deletingDoc.id);
    setDeletingDoc(null);
    await refresh();
  }

  async function handleRenameSubmit(title: string) {
    if (!repository || !renamingDoc) return;
    await repository.rename(renamingDoc.id, title);
    await refresh();
  }

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.doc.title.toLowerCase().includes(q));
  }, [cards, query]);

  const hiddenPdfInput = (
    <input
      ref={pdfInputRef}
      type="file"
      accept="application/pdf"
      onChange={handleImportPdf}
      disabled={importingPdf}
      className="visually-hidden"
      aria-label="Import PDF file"
    />
  );

  return (
    <div
      className="app-shell-with-sidebar"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="dnd-overlay">
          <div className="dnd-overlay-card">
            <UploadIcon width={28} height={28} />
            Drop to import
          </div>
        </div>
      )}
      <Sidebar active="library" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-shell-content">
      <AppShell
      start={
        <>
          <button
            type="button"
            className="btn btn-icon sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <ListIcon />
          </button>
          <span className="brand">
            <span className="brand-mark">灵</span>Lingxi
          </span>
        </>
      }
      end={
        <>
          <label className="library-search field" style={{ margin: 0 }}>
            <span className="visually-hidden">Search your library</span>
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <SearchIcon />
              <input
                className="input"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
          </label>
          <ThemeToggle />
        </>
      }
    >
      {hiddenPdfInput}

      <div className="library-page">
        {!ready || !cards ? (
          <p className="status-message">Loading library…</p>
        ) : cards.length === 0 ? (
          <EmptyState onImportPdf={() => pdfInputRef.current?.click()} onPasteText={() => setPasteDialogOpen(true)} />
        ) : (
          <section>
            <div className="library-section-header">
              <h1 className="library-section-title">Library</h1>
              <div className="library-view-toggle" role="group" aria-label="Library view">
                <button
                  type="button"
                  className={`btn btn-icon${view === 'grid' ? ' is-active' : ''}`}
                  aria-label="Grid view"
                  onClick={() => changeView('grid')}
                >
                  <GridIcon />
                </button>
                <button
                  type="button"
                  className={`btn btn-icon${view === 'list' ? ' is-active' : ''}`}
                  aria-label="List view"
                  onClick={() => changeView('list')}
                >
                  <ListIcon />
                </button>
              </div>
              <AddMenu onImportPdf={() => pdfInputRef.current?.click()} onPasteText={() => setPasteDialogOpen(true)} />
            </div>

            {error && <p className="error-message">{error}</p>}
            {importingPdf && <p className="status-message">Importing…</p>}

            {filtered.length === 0 ? (
              <p className="status-message">No documents match "{query}".</p>
            ) : view === 'grid' ? (
              <div className="document-grid">
                {filtered.map((card) => (
                  <DocumentCard
                    key={card.doc.id}
                    data={card}
                    onOpen={() => onOpenDocument(card.doc.id)}
                    onRename={() => setRenamingDoc(card.doc)}
                    onDelete={() => setDeletingDoc(card.doc)}
                  />
                ))}
              </div>
            ) : (
              <LibraryTable
                cards={filtered}
                onOpenDocument={onOpenDocument}
                onRename={setRenamingDoc}
                onDelete={setDeletingDoc}
              />
            )}
          </section>
        )}
      </div>

      {pasteDialogOpen && <PasteTextDialog onClose={() => setPasteDialogOpen(false)} onSubmit={handlePasteSubmit} />}

      {renamingDoc && (
        <RenameDialog
          initialTitle={renamingDoc.title}
          onClose={() => setRenamingDoc(null)}
          onSubmit={handleRenameSubmit}
        />
      )}

      {deletingDoc && (
        <ConfirmDialog
          title="Delete document"
          message={`Delete "${deletingDoc.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingDoc(null)}
        />
      )}
      </AppShell>
      </div>
    </div>
  );
}
