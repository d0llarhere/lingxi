import type { AudioItemRecord } from '@lingxi/core';
import { EditIcon, EqualizerIcon, MusicNoteIcon, PauseIcon, PlayIcon, TrashIcon, UploadIcon } from '../components/icons';
import { OverflowMenu, type MenuAction } from '../components/OverflowMenu';
import { formatDuration } from '../reader/formatDuration';
import { useChapterDetection } from '../settings/useChapterDetection';
import { EDGE_VOICES } from '../tts/edge/EdgeTTSEngine';
import { KOKORO_VOICES } from '../tts/kokoro/KokoroTTSEngine';
import { thumbColor, thumbInitial } from './DocumentRow';
import { formatBytes } from './StorageCard';
import { useApproxBookPosition } from './useApproxBookPosition';

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

function formatLengthLabel(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export function DownloadRow({ item, isPlaying, onPlay, onRename, onAttachSubtitles, onDelete }: DownloadRowProps) {
  const { settings: chapterDetection } = useChapterDetection();
  const percent = item.durationMs > 0 ? Math.round((item.positionMs / item.durationMs) * 100) : 0;
  const color = thumbColor(item.title);
  const bookPosition = useApproxBookPosition(item.documentId, item.positionMs, item.durationMs, chapterDetection);

  const detailLine =
    item.kind === 'book'
      ? [item.chapterLabel, item.voiceURI ? voiceName(item.voiceURI) : null, `${item.rate}×`].filter(Boolean).join(' · ')
      : item.subtitleFilename
        ? `Subtitles: ${item.subtitleFilename}`
        : 'No subtitles';

  const positionLabel =
    item.positionMs <= 0
      ? 'Not started'
      : bookPosition
        ? `Ch. ${bookPosition.chapterNumber} · ${formatDuration(item.positionMs / 1000)}`
        : formatDuration(item.positionMs / 1000);

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
      <span className="doc-row-length">{formatLengthLabel(item.durationMs)}</span>
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
