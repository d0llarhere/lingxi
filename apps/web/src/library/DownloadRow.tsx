import { detectChapters, type AudioItemRecord } from '@lingxi/core';
import { useEffect, useState } from 'react';
import { EditIcon, EqualizerIcon, MusicNoteIcon, PauseIcon, PlayIcon, TrashIcon, UploadIcon } from '../components/icons';
import { OverflowMenu, type MenuAction } from '../components/OverflowMenu';
import { useChapterDetection } from '../settings/useChapterDetection';
import { EDGE_VOICES } from '../tts/edge/EdgeTTSEngine';
import { KOKORO_VOICES } from '../tts/kokoro/KokoroTTSEngine';
import { findChapterAt, thumbColor, thumbInitial } from './DocumentRow';
import { useLibrary } from './LibraryProvider';
import { formatBytes } from './StorageCard';

interface DownloadRowProps {
  item: AudioItemRecord;
  isPlaying: boolean;
  onPlay: () => void;
  onRename: () => void;
  onAttachSubtitles: () => void;
  onDelete: () => void;
}

const ALL_VOICES = [...KOKORO_VOICES, ...EDGE_VOICES];

function voiceName(voiceURI: string): string {
  return ALL_VOICES.find((v) => v.voiceURI === voiceURI)?.name ?? voiceURI;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export function DownloadRow({ item, isPlaying, onPlay, onRename, onAttachSubtitles, onDelete }: DownloadRowProps) {
  const { repository } = useLibrary();
  const { settings: chapterDetection } = useChapterDetection();
  const [chapter, setChapter] = useState<{ number: number; title: string } | null>(null);
  const percent = item.durationMs > 0 ? Math.round((item.positionMs / item.durationMs) * 100) : 0;
  const color = thumbColor(item.title);

  // Approximates the chapter at the current position from the document's
  // overall char-count/duration ratio — the same linear chars-per-second
  // estimate DocumentRow.formatLength already relies on — rather than
  // persisting a per-chunk time→offset timeline just for this display.
  useEffect(() => {
    if (item.kind !== 'book' || !item.documentId || item.positionMs <= 0 || !repository || chapterDetection.mode === 'off') {
      setChapter(null);
      return;
    }
    let cancelled = false;
    repository.getDocumentText(item.documentId).then((text) => {
      if (cancelled || !text) return;
      const approxCharOffset = Math.round((item.positionMs / item.durationMs) * text.length);
      const chapters = detectChapters(text, chapterDetection);
      setChapter(findChapterAt(chapters, approxCharOffset));
    });
    return () => {
      cancelled = true;
    };
  }, [repository, item.kind, item.documentId, item.positionMs, item.durationMs, chapterDetection]);

  const detailLine =
    item.kind === 'book'
      ? [item.chapterLabel, item.voiceURI ? voiceName(item.voiceURI) : null, `${item.rate}×`].filter(Boolean).join(' · ')
      : item.subtitleFilename
        ? `Subtitles: ${item.subtitleFilename}`
        : 'No subtitles';

  const positionLabel =
    item.positionMs <= 0
      ? 'Not started'
      : chapter
        ? `Ch. ${chapter.number} · ${formatClock(item.positionMs)}`
        : formatClock(item.positionMs);

  const menuActions: MenuAction[] = [
    { label: 'Rename', icon: <EditIcon />, onSelect: onRename },
    { label: 'Attach subtitles…', icon: <UploadIcon />, onSelect: onAttachSubtitles },
    { label: 'Delete', icon: <TrashIcon />, onSelect: onDelete, danger: true },
  ];

  return (
    <div className={`doc-row download-row${isPlaying ? ' download-row-playing' : ''}`} role="row">
      <div className="doc-row-thumb" style={{ background: color.bg, color: color.fg }} aria-hidden="true">
        {isPlaying ? <EqualizerIcon /> : item.kind === 'imported' ? <MusicNoteIcon /> : thumbInitial(item.title)}
      </div>
      <div className="doc-row-title-group" style={{ cursor: 'default' }}>
        <span className="doc-row-title">{item.title}</span>
        <span className="download-row-detail">
          <span className={`download-tag${item.kind === 'imported' ? ' download-tag-imported' : ''}`}>
            {item.kind === 'imported' ? 'Imported' : 'From book'}
          </span>
          <span>{detailLine}</span>
        </span>
      </div>
      <div className="doc-row-progress">
        <span className="progress-track">
          <span className="progress-fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="doc-row-progress-value">{positionLabel}</span>
      </div>
      <span className="doc-row-length">{formatDuration(item.durationMs)}</span>
      <span className="doc-row-opened">{formatBytes(item.sizeBytes)}</span>
      <div className="doc-row-actions">
        <button
          type="button"
          className={`doc-row-play${item.positionMs > 0 ? ' doc-row-play-active' : ''}`}
          aria-label={isPlaying ? 'Pause' : item.positionMs > 0 ? 'Resume' : 'Play'}
          onClick={onPlay}
        >
          {isPlaying ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
        </button>
        <OverflowMenu actions={menuActions} label={`More actions for ${item.title}`} />
      </div>
    </div>
  );
}
