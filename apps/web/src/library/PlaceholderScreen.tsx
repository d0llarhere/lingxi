import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ListIcon } from '../components/icons';
import { ThemeToggle } from '../theme/ThemeToggle';
import { type NavKey, Sidebar } from './Sidebar';

// The only remaining placeholder route — App.tsx already routes
// 'library'/'settings' to their own real screens, so this is always
// 'downloads' until commit [downloads-screen] gives it a real one too
// (at which point this whole file goes away).
const TITLES: Record<'downloads', string> = {
  downloads: 'Downloads',
};

interface PlaceholderScreenProps {
  nav: 'downloads';
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
