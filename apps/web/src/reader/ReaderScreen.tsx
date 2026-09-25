import type { LingxiDocument } from '@lingxi/core';
import { useEffect, useState } from 'react';
import { useLibrary } from '../library/LibraryProvider';

interface ReaderScreenProps {
  documentId: string;
  onBack: () => void;
}

export function ReaderScreen({ documentId, onBack }: ReaderScreenProps) {
  const { repository, ready } = useLibrary();
  const [doc, setDoc] = useState<LingxiDocument | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;

    (async () => {
      const [fetchedDoc, fetchedText] = await Promise.all([
        repository.getDocument(documentId),
        repository.getDocumentText(documentId),
      ]);
      await repository.touchLastOpened(documentId);
      if (cancelled) return;
      setDoc(fetchedDoc ?? null);
      setText(fetchedText ?? '');
    })();

    return () => {
      cancelled = true;
    };
  }, [repository, documentId]);

  if (!ready || !doc) {
    return <p>Loading document…</p>;
  }

  return (
    <section>
      <button onClick={onBack}>Back to library</button>
      <h1>{doc.title}</h1>
      {doc.extractionStatus === 'no-text' ? (
        <p role="alert">This PDF appears to contain scanned/image pages. OCR is not enabled yet.</p>
      ) : (
        <article style={{ whiteSpace: 'pre-wrap' }}>{text}</article>
      )}
    </section>
  );
}
