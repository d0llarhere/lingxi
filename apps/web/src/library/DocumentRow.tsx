import { detectChapters, type ChapterRef } from '@lingxi/core';
import { useEffect, useState } from 'react';
import { DownloadIcon, EditIcon, PlayIcon, TrashIcon } from '../components/icons';
import { OverflowMenu } from '../components/OverflowMenu';
import { ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 } from '../reader/formatDuration';
import { useChapterDetection } from '../settings/useChapterDetection';
import type { DocumentCardData } from './DocumentCard';
import { DownloadRangeDialog } from './DownloadRangeDialog';
import { useLibrary } from './LibraryProvider';

interface DocumentRowProps {
  data: DocumentCardData;
  onOpen: () => void;
  // The round play button starts or resumes listening right away, unlike
  // clicking the title which just opens to the current position (brief's
  // "starts or resumes listening right away").
  onPlay: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const THUMB_PALETTE = [
  { bg: '#2c4a3f', fg: '#a3dcc5' },
  { bg: '#3a3448', fg: '#cbbef0' },
  { bg: '#2c3a4a', fg: '#a3c4ec' },
  { bg: '#4a3a2c', fg: '#ecc4a3' },
];

// Exported for reuse by DownloadRow.tsx — downloaded/imported audio items
// get the same hash-based cover color and initial glyph as library rows.
export function thumbColor(title: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return THUMB_PALETTE[Math.abs(hash) % THUMB_PALETTE.length]!;
}

export function thumbInitial(title: string): string {
  const cjk = title.match(/[㐀-鿿぀-ヿ가-힯]/);
  return cjk?.[0] ?? title.trim().charAt(0).toUpperCase() ?? '?';
}

function formatLastOpened(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatLength(totalPages: number, totalChars: number, rate: number): string {
  if (totalPages > 1) return `${totalPages} pages`;
  const minutes = Math.round(totalChars / (ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 * rate) / 60);
  return `~${Math.max(1, minutes)} min`;
}

export function DocumentRow({ data, onOpen, onPlay, onRename, onDelete }: DocumentRowProps) {
  const { doc, progress, charOffset, totalPages, totalChars } = data;
  const { repository } = useLibrary();
  const { settings: chapterDetection } = useChapterDetection();
  const [chapter, setChapter] = useState<{ number: number; title: string } | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const percent = Math.round(progress * 100);
  const color = thumbColor(doc.title);

  // Chapter lookup needs the document's full text, which the row list
  // doesn't otherwise load — only fetched for in-progress rows, and only
  // this one row's text, not the whole library's (see
  // lingxi-redesign/REDESIGN_BRIEF.md's library list spec).
  useEffect(() => {
    if (progress <= 0 || !repository) return;
    if (chapterDetection.mode === 'off') {
      setChapter(null);
      return;
    }
    let cancelled = false;
    repository.getDocumentText(doc.id).then((text) => {
      if (cancelled || !text) return;
      const chapters = detectChapters(text, chapterDetection);
      const found = findChapterAt(chapters, charOffset);
      if (found) setChapter(found);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, doc.id, progress, charOffset, chapterDetection]);

  const sourceLabel = doc.sourceType === 'pdf' ? 'PDF' : 'Text';
  const positionLabel = progress <= 0 ? 'not started' : chapter ? `Chapter ${chapter.number} · ${chapter.title}` : `${percent}% read`;

  const menuActions = [
    { label: 'Rename', icon: <EditIcon />, onSelect: onRename },
    { label: 'Download for offline', icon: <DownloadIcon />, onSelect: () => setDownloadDialogOpen(true) },
    { label: 'Delete', icon: <TrashIcon />, onSelect: onDelete, danger: true },
  ];

  return (
    <div className="doc-row" role="row">
      <div className="doc-row-thumb" style={{ background: color.bg, color: color.fg }} aria-hidden="true">
        {thumbInitial(doc.title)}
      </div>
      <button type="button" className="doc-row-title-group" onClick={onOpen}>
        <span className="doc-row-title">{doc.title}</span>
        <span className="doc-row-subtitle">
          {sourceLabel} · {positionLabel}
        </span>
      </button>
      <div className="doc-row-progress">
        <span className="progress-track">
          <span className="progress-fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="doc-row-progress-value">{percent}%</span>
      </div>
      <span className="doc-row-length">{formatLength(totalPages, totalChars, 1)}</span>
      <span className="doc-row-opened">{formatLastOpened(doc.lastOpenedAt)}</span>
      <div className="doc-row-actions">
        <button
          type="button"
          className={`doc-row-play${progress > 0 ? ' doc-row-play-active' : ''}`}
          aria-label={progress > 0 ? 'Resume listening' : 'Start listening'}
          onClick={onPlay}
        >
          <PlayIcon width={14} height={14} />
        </button>
        <OverflowMenu actions={menuActions} label={`More actions for ${doc.title}`} />
      </div>
      {downloadDialogOpen && <DownloadRangeDialog documentId={doc.id} onClose={() => setDownloadDialogOpen(false)} />}
    </div>
  );
}

// Exported for reuse by DownloadRow.tsx, which approximates a book audio
// item's current chapter from its playback position the same way.
export function findChapterAt(chapters: ChapterRef[], charOffset: number): { number: number; title: string } | null {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.charStart <= charOffset) index = i;
    else break;
  }
  if (index === -1) return null;
  return { number: index + 1, title: chapters[index]!.title };
}
