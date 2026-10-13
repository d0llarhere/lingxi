import { AppShell } from '../components/AppShell';
import { BookIcon, ChevronLeftIcon, EditIcon, SearchIcon, TrashIcon } from '../components/icons';
import { OverflowMenu } from '../components/OverflowMenu';
import { ThemeToggle } from '../theme/ThemeToggle';

interface ReaderHeaderProps {
  title: string;
  // "Chapter {n} · {title}" — brief's two-line header. Absent when
  // detectChapters found nothing for this document.
  chapterSubtitle?: string;
  onBack: () => void;
  onRename: () => void;
  onDelete: () => void;
  onToggleToc?: () => void;
  onToggleSearch?: () => void;
  children: React.ReactNode;
}

export function ReaderHeader({
  title,
  chapterSubtitle,
  onBack,
  onRename,
  onDelete,
  onToggleToc,
  onToggleSearch,
  children,
}: ReaderHeaderProps) {
  return (
    <AppShell
      start={
        <>
          <button type="button" className="btn btn-icon" onClick={onBack} aria-label="Back to library">
            <ChevronLeftIcon />
          </button>
          <span className="topbar-title-group">
            <span className="topbar-title">{title}</span>
            {chapterSubtitle && <span className="topbar-subtitle">{chapterSubtitle}</span>}
          </span>
        </>
      }
      end={
        <>
          {onToggleSearch && (
            <button type="button" className="btn btn-icon" onClick={onToggleSearch} aria-label="Search this document">
              <SearchIcon />
            </button>
          )}
          {onToggleToc && (
            <button type="button" className="btn btn-icon" onClick={onToggleToc} aria-label="Table of contents">
              <BookIcon />
            </button>
          )}
          <ThemeToggle />
          <OverflowMenu
            label={`More actions for ${title}`}
            actions={[
              { label: 'Rename', icon: <EditIcon />, onSelect: onRename },
              { label: 'Delete', icon: <TrashIcon />, onSelect: onDelete, danger: true },
            ]}
          />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
