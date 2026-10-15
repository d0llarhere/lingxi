import { useState } from 'react';
import { ListIcon } from '../components/icons';
import { ChaptersSection } from './ChaptersSection';
import { ReadingSection } from './ReadingSection';
import { type NavKey, Sidebar } from './Sidebar';
import { StorageSection } from './StorageSection';

// Nav order per docs/lingxi-part3/BRIEF_SETTINGS_PAGES.md: Reading ·
// Listening · Chapters · Storage · Appearance · About.
export type SettingsSection = 'reading' | 'chapters' | 'storage';

const NAV_ITEMS: { key: SettingsSection; label: string }[] = [
  { key: 'reading', label: 'Reading' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'storage', label: 'Storage' },
];

interface SettingsScreenProps {
  onNavigate: (nav: NavKey, settingsSection?: SettingsSection) => void;
  initialSection?: SettingsSection;
}

export function SettingsScreen({ onNavigate, initialSection }: SettingsScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'chapters');

  return (
    <div className="app-shell-with-sidebar">
      <Sidebar active="settings" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-shell-content">
        <div className="settings-mobile-bar">
          <button
            type="button"
            className="btn btn-icon sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <ListIcon />
          </button>
        </div>

        <div className="settings-layout">
          <nav aria-label="Settings sections" className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {/* Listening/Appearance/About land here as their own commits —
                the brief's own rule is to leave undefined sections out of the
                nav rather than show an empty page. */}
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`settings-nav-item${section === item.key ? ' settings-nav-item-active' : ''}`}
                onClick={() => setSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <main className="settings-main">
            {section === 'reading' ? (
              <ReadingSection />
            ) : section === 'storage' ? (
              <StorageSection onOpenLibrary={() => onNavigate('library')} />
            ) : (
              <ChaptersSection />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
