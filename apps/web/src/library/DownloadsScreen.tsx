import type { AudioItemRecord } from '@lingxi/core';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ListIcon, SearchIcon, SettingsIcon, SortIcon, UploadIcon } from '../components/icons';
import { OverflowMenu, type MenuAction } from '../components/OverflowMenu';
import { AudioPill } from '../reader/AudioPill';
import { ThemeToggle } from '../theme/ThemeToggle';
import { getAudioLibraryRepository } from './audioLibraryInstance';
import { DownloadRow } from './DownloadRow';
import { RenameDialog } from './RenameDialog';
import type { SettingsSection } from './SettingsScreen';
import { Sidebar, type NavKey } from './Sidebar';

type Filter = 'all' | 'book' | 'imported';
type SortKey = 'lastPlayed' | 'name' | 'size' | 'dateAdded';

const SORT_LABELS: Record<SortKey, string> = {
  lastPlayed: 'Last played',
  name: 'Name',
  size: 'Size',
  dateAdded: 'Date added',
};
const SORT_CYCLE: SortKey[] = ['lastPlayed', 'name', 'size', 'dateAdded'];
const SORT_STORAGE_KEY = 'lingxi-downloads-sort';

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Math.round(audio.duration * 1000));
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read audio duration'));
    };
    audio.src = url;
  });
}

function sortCompare(a: AudioItemRecord, b: AudioItemRecord, key: SortKey): number {
  switch (key) {
    case 'lastPlayed':
      return (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt);
    case 'name':
      return a.title.localeCompare(b.title);
    case 'size':
      return b.sizeBytes - a.sizeBytes;
    case 'dateAdded':
      return b.createdAt - a.createdAt;
  }
}

interface DownloadsScreenProps {
  onOpenDocument: (documentId: string, options?: { autoplay?: boolean }) => void;
  onNavigate: (nav: NavKey, settingsSection?: SettingsSection) => void;
}

export function DownloadsScreen({ onOpenDocument, onNavigate }: DownloadsScreenProps) {
  const [items, setItems] = useState<AudioItemRecord[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>(() => {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    return (SORT_CYCLE as string[]).includes(stored ?? '') ? (stored as SortKey) : 'lastPlayed';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [renamingItem, setRenamingItem] = useState<AudioItemRecord | null>(null);
  const [deletingItem, setDeletingItem] = useState<AudioItemRecord | null>(null);
  const [importing, setImporting] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const subtitleTargetRef = useRef<AudioItemRecord | null>(null);

  async function refresh() {
    const repo = await getAudioLibraryRepository();
    setItems(await repo.listAudioItems());
  }

  useEffect(() => {
    refresh();
  }, []);

  function changeSort(next: SortKey) {
    setSort(next);
    localStorage.setItem(SORT_STORAGE_KEY, next);
  }

  function cycleSort() {
    const index = SORT_CYCLE.indexOf(sort);
    changeSort(SORT_CYCLE[(index + 1) % SORT_CYCLE.length]!);
  }

  async function handleImportAudio(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (audioInputRef.current) audioInputRef.current.value = '';
    if (files.length === 0) return;

    setImporting(true);
    const repo = await getAudioLibraryRepository();
    for (const file of files) {
      const durationMs = await readAudioDuration(file).catch(() => 0);
      await repo.saveAudioItem({
        id: crypto.randomUUID(),
        kind: 'imported',
        title: file.name.replace(/\.[^./]+$/, ''),
        createdAt: Date.now(),
        lastPlayedAt: null,
        sizeBytes: file.size,
        durationMs,
        audioBlob: file,
        mimeType: file.type,
        positionMs: 0,
        rate: 1,
        subtitlesOn: false,
        subtitleFilename: null,
        subtitleText: null,
        documentId: null,
        voiceURI: null,
        chapterLabel: null,
        chunkRanges: [],
        audioReady: true,
      });
    }
    setImporting(false);
    await refresh();
  }

  async function handleAttachSubtitlesFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const target = subtitleTargetRef.current;
    if (subtitleInputRef.current) subtitleInputRef.current.value = '';
    if (!file || !target) return;

    const text = await file.text();
    const repo = await getAudioLibraryRepository();
    await repo.updateAudioItemSettings(target.id, { subtitleFilename: file.name, subtitleText: text, subtitlesOn: true });
    await refresh();
  }

  async function handleRenameSubmit(title: string) {
    if (!renamingItem) return;
    const repo = await getAudioLibraryRepository();
    await repo.updateAudioItemSettings(renamingItem.id, { title });
    await refresh();
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return;
    const repo = await getAudioLibraryRepository();
    await repo.deleteAudioItem(deletingItem.id);
    if (playingId === deletingItem.id) setPlayingId(null);
    setDeletingItem(null);
    await refresh();
  }

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => filter === 'all' || item.kind === filter)
      .filter((item) => !q || item.title.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => sortCompare(a, b, sort));
  }, [items, query, filter, sort]);

  const playingItem = items?.find((item) => item.id === playingId) ?? null;

  const counts = useMemo(() => {
    if (!items) return { all: 0, book: 0, imported: 0 };
    return {
      all: items.length,
      book: items.filter((item) => item.kind === 'book').length,
      imported: items.filter((item) => item.kind === 'imported').length,
    };
  }, [items]);

  const menuActions: MenuAction[] = [
    {
      label: 'Import audio…',
      icon: <UploadIcon />,
      onSelect: () => audioInputRef.current?.click(),
      detail: 'mp3, m4a, wav',
    },
    { label: 'Sort by', icon: <SortIcon />, onSelect: cycleSort, detail: `${SORT_LABELS[sort]} ›` },
    { label: 'Manage storage', icon: <SettingsIcon />, onSelect: () => onNavigate('settings', 'storage') },
  ];

  return (
    <div className="app-shell-with-sidebar">
      <Sidebar active="downloads" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
              <span className="brand">Downloads</span>
            </>
          }
          end={
            <>
              <label className="library-search field" style={{ margin: 0 }}>
                <span className="visually-hidden">Search downloads</span>
                <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <SearchIcon />
                  <input
                    className="input"
                    placeholder="Search audio"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </span>
              </label>
              <OverflowMenu actions={menuActions} label="More options" />
              <ThemeToggle />
            </>
          }
        >
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={handleImportAudio}
            className="visually-hidden"
            aria-label="Import audio files"
          />
          <input
            ref={subtitleInputRef}
            type="file"
            accept=".srt,.vtt"
            onChange={handleAttachSubtitlesFile}
            className="visually-hidden"
            aria-label="Attach subtitle file"
          />

          <div className="library-page">
            <div className="library-section-header">
              <div>
                <h1 className="library-section-title">Downloads</h1>
                <p className="download-subtitle">Audio saved on this device · plays offline</p>
              </div>
            </div>

            <div className="chapters-preset-row">
              <button
                type="button"
                className={`chapters-preset-chip${filter === 'all' ? ' chapters-preset-chip-active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All · {counts.all}
              </button>
              <button
                type="button"
                className={`chapters-preset-chip${filter === 'book' ? ' chapters-preset-chip-active' : ''}`}
                onClick={() => setFilter('book')}
              >
                From books
              </button>
              <button
                type="button"
                className={`chapters-preset-chip${filter === 'imported' ? ' chapters-preset-chip-active' : ''}`}
                onClick={() => setFilter('imported')}
              >
                Imported
              </button>
            </div>

            {importing && <p className="status-message">Importing…</p>}

            {!items ? (
              <p className="status-message">Loading downloads…</p>
            ) : items.length === 0 ? (
              <p className="status-message">
                No downloads yet. Download a book for offline listening from its ⋯ menu, or import audio above.
              </p>
            ) : filtered.length === 0 ? (
              <p className="status-message">No audio matches "{query}".</p>
            ) : (
              <div className="doc-table">
                <div className="doc-row doc-row-header" role="row">
                  <span />
                  <span className="doc-table-th">Audio</span>
                  <span className="doc-table-th">Where you left off</span>
                  <span className="doc-table-th">Length</span>
                  <span className="doc-table-th">Size</span>
                  <span />
                </div>
                {filtered.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    isPlaying={playingId === item.id}
                    onPlay={() => setPlayingId((current) => (current === item.id ? null : item.id))}
                    onOpenDocument={onOpenDocument}
                    onRename={() => setRenamingItem(item)}
                    onAttachSubtitles={() => {
                      subtitleTargetRef.current = item;
                      subtitleInputRef.current?.click();
                    }}
                    onDelete={() => setDeletingItem(item)}
                  />
                ))}
              </div>
            )}
          </div>

          {renamingItem && (
            <RenameDialog
              heading="Rename audio"
              initialTitle={renamingItem.title}
              onClose={() => setRenamingItem(null)}
              onSubmit={handleRenameSubmit}
            />
          )}

          {deletingItem && (
            <ConfirmDialog
              title="Delete audio"
              message={`Delete "${deletingItem.title}"? This cannot be undone.`}
              confirmLabel="Delete"
              danger
              onConfirm={handleConfirmDelete}
              onCancel={() => setDeletingItem(null)}
            />
          )}

          {playingItem && (
            <div className="pill-dock">
              <AudioPill item={playingItem} onClose={() => setPlayingId(null)} onPersisted={refresh} />
            </div>
          )}
        </AppShell>
      </div>
    </div>
  );
}
