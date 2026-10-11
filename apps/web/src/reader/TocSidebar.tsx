import { CloseIcon } from '../components/icons';

export interface TocEntry {
  title: string;
  charStart: number;
}

interface TocSidebarProps {
  entries: TocEntry[];
  activeCharOffset: number;
  onSelect: (charStart: number) => void;
  onClose: () => void;
}

// Docked alongside the reading surface (restructures .reader-page into a
// row — see reader.css), not a floating dropdown like OverflowMenu, since
// it's meant to stay open while navigating. Row styling reuses .menu-item
// (components.css) — the closest existing precedent for a clickable list.
export function TocSidebar({ entries, activeCharOffset, onSelect, onClose }: TocSidebarProps) {
  // Highlights whichever entry the reading cursor is currently past, not
  // necessarily the first one — same "where am I" semantics as the page
  // counter in PlaybackControls.
  let activeIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.charStart <= activeCharOffset) activeIndex = i;
    else break;
  }

  return (
    <aside className="toc-sidebar card">
      <div className="toc-sidebar-header">
        <span className="toc-sidebar-title">Contents</span>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close contents">
          <CloseIcon />
        </button>
      </div>
      <nav className="toc-sidebar-list">
        {entries.length === 0 ? (
          <p className="status-message toc-sidebar-empty">No sections detected.</p>
        ) : (
          entries.map((entry, i) => (
            <button
              key={`${entry.charStart}-${entry.title}`}
              type="button"
              className={`menu-item toc-sidebar-item${i === activeIndex ? ' is-active' : ''}`}
              onClick={() => onSelect(entry.charStart)}
            >
              {entry.title}
            </button>
          ))
        )}
      </nav>
    </aside>
  );
}
