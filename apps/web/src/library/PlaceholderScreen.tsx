import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ListIcon } from '../components/icons';
import { ThemeToggle } from '../theme/ThemeToggle';
import { type NavKey, Sidebar } from './Sidebar';

const TITLES: Record<Exclude<NavKey, 'library'>, string> = {
  listening: 'Listening',
  downloads: 'Downloads',
  bookmarks: 'Bookmarks',
  voices: 'Voices',
  settings: 'Settings',
};

interface PlaceholderScreenProps {
  nav: Exclude<NavKey, 'library'>;
  onNavigate: (nav: NavKey) => void;
}

export function PlaceholderScreen({ nav, onNavigate }: PlaceholderScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const title = TITLES[nav];

  return (
    <div className="app-shell-with-sidebar">
      <Sidebar active={nav} onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
              <span className="brand">{title}</span>
            </>
          }
          end={<ThemeToggle />}
        >
          <div className="library-page">
            <p className="status-message">{title} — coming soon.</p>
          </div>
        </AppShell>
      </div>
    </div>
  );
}
