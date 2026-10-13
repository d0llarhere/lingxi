import { BookmarkIcon, DownloadIcon, HeadphonesIcon, LibraryIcon, MicIcon, SettingsIcon } from '../components/icons';
import { OfflineStorageCard } from './OfflineStorageCard';

export type NavKey = 'library' | 'listening' | 'downloads' | 'bookmarks' | 'voices' | 'settings';

const NAV_ITEMS: { key: NavKey; label: string; icon: JSX.Element }[] = [
  { key: 'library', label: 'Library', icon: <LibraryIcon width={18} height={18} /> },
  { key: 'listening', label: 'Listening', icon: <HeadphonesIcon width={18} height={18} /> },
  { key: 'downloads', label: 'Downloads', icon: <DownloadIcon width={18} height={18} /> },
  { key: 'bookmarks', label: 'Bookmarks', icon: <BookmarkIcon width={18} height={18} /> },
  { key: 'voices', label: 'Voices', icon: <MicIcon width={18} height={18} /> },
];

interface SidebarProps {
  active: NavKey;
  onNavigate: (nav: NavKey) => void;
  // Mobile drawer state — ignored by the desktop rail (see CSS), see
  // lingxi-redesign/REDESIGN_BRIEF.md's "below 900px" note.
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ active, onNavigate, open, onClose }: SidebarProps) {
  function navigate(nav: NavKey) {
    onNavigate(nav);
    onClose();
  }

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} />}
      <nav aria-label="Main" className={`sidebar${open ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">灵</span>Lingxi
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar-nav${active === item.key ? ' sidebar-nav-active' : ''}`}
            onClick={() => navigate(item.key)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <div className="sidebar-spacer" />
        <OfflineStorageCard />
        <button
          type="button"
          className={`sidebar-nav${active === 'settings' ? ' sidebar-nav-active' : ''}`}
          onClick={() => navigate('settings')}
        >
          <SettingsIcon width={18} height={18} />
          Settings
        </button>
      </nav>
    </>
  );
}
