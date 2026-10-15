import { useState } from 'react';
import { DownloadsScreen } from './library/DownloadsScreen';
import { LibraryProvider } from './library/LibraryProvider';
import { LibraryScreen } from './library/LibraryScreen';
import { SettingsScreen, type SettingsSection } from './library/SettingsScreen';
import type { NavKey } from './library/Sidebar';
import { ReaderScreen } from './reader/ReaderScreen';

type View =
  | { type: 'nav'; nav: NavKey; settingsSection?: SettingsSection }
  | { type: 'reader'; documentId: string; autoplay?: boolean };

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

  function navigate(nav: NavKey, settingsSection?: SettingsSection) {
    setView({ type: 'nav', nav, settingsSection });
  }

  return (
    <LibraryProvider>
      {view.nav === 'library' ? (
        <LibraryScreen
          onOpenDocument={(documentId, options) => setView({ type: 'reader', documentId, autoplay: options?.autoplay })}
          onNavigate={navigate}
        />
      ) : view.nav === 'settings' ? (
        <SettingsScreen onNavigate={navigate} initialSection={view.settingsSection} />
      ) : (
        <DownloadsScreen onNavigate={navigate} />
      )}
    </LibraryProvider>
  );
}
