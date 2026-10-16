import { useState } from 'react';
import { DownloadsScreen } from './library/DownloadsScreen';
import { LibraryProvider } from './library/LibraryProvider';
import { LibraryScreen } from './library/LibraryScreen';
import { SettingsScreen, type SettingsSection } from './library/SettingsScreen';
import type { NavKey } from './library/Sidebar';
import { ReaderScreen } from './reader/ReaderScreen';
import { useAccentColor } from './theme/useAccentColor';
import { useReduceMotion } from './theme/useReduceMotion';

type View =
  | { type: 'nav'; nav: NavKey; settingsSection?: SettingsSection }
  | { type: 'reader'; documentId: string; autoplay?: boolean };

export function App() {
  const [view, setView] = useState<View>({ type: 'nav', nav: 'library' });
  // Mounted once, app-wide, purely for their CSS-custom-property side
  // effects (see each hook's own doc comment) — not every screen renders a
  // ThemeToggle/Appearance page, so this is the one place guaranteed to run
  // regardless of route.
  useAccentColor();
  useReduceMotion();

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
        <DownloadsScreen
          onOpenDocument={(documentId, options) => setView({ type: 'reader', documentId, autoplay: options?.autoplay })}
          onNavigate={navigate}
        />
      )}
    </LibraryProvider>
  );
}
