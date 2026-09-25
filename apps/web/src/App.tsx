import { useState } from 'react';
import { LibraryProvider } from './library/LibraryProvider';
import { LibraryScreen } from './library/LibraryScreen';
import { ReaderScreen } from './reader/ReaderScreen';

type View = { type: 'library' } | { type: 'reader'; documentId: string };

export function App() {
  const [view, setView] = useState<View>({ type: 'library' });

  return (
    <LibraryProvider>
      {view.type === 'library' ? (
        <LibraryScreen onOpenDocument={(documentId) => setView({ type: 'reader', documentId })} />
      ) : (
        <ReaderScreen documentId={view.documentId} onBack={() => setView({ type: 'library' })} />
      )}
    </LibraryProvider>
  );
}
