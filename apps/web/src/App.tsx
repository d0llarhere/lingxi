import { useState } from 'react';
import { LibraryProvider } from './library/LibraryProvider';
import { LibraryScreen } from './library/LibraryScreen';
import { PlaceholderScreen } from './library/PlaceholderScreen';
import { SettingsScreen } from './library/SettingsScreen';
import type { NavKey } from './library/Sidebar';
import { ReaderScreen } from './reader/ReaderScreen';

type View = { type: 'nav'; nav: NavKey } | { type: 'reader'; documentId: string; autoplay?: boolean };

export function App() {
  const [view, setView] = useState<View>({ type: 'nav', nav: 'library' });

  if (view.type === 'reader') {
    return (
      <LibraryProvider>
        <ReaderScreen
          documentId={view.documentId}
          autoplay={view.autoplay}
          onBack={() => setView({ type: 'nav', nav: 'library' })}
        />
      </LibraryProvider>
    );
  }

  return (
    <LibraryProvider>
      {view.nav === 'library' ? (
        <LibraryScreen
          onOpenDocument={(documentId, options) => setView({ type: 'reader', documentId, autoplay: options?.autoplay })}
          onNavigate={(nav) => setView({ type: 'nav', nav })}
        />
      ) : view.nav === 'settings' ? (
        <SettingsScreen onNavigate={(nav) => setView({ type: 'nav', nav })} />
      ) : (
        <PlaceholderScreen nav={view.nav} onNavigate={(nav) => setView({ type: 'nav', nav })} />
      )}
    </LibraryProvider>
  );
}
