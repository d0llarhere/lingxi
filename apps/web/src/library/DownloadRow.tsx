import {
  buildChunkSequence,
  chunkCharRanges,
  detectChapters,
  findPageIndexAtOffset,
  mergeChunkRanges,
  type AudioItemRecord,
  type ChapterRef,
  type ChunkIndexRange,
  type PageRef,
} from '@lingxi/core';
import { useEffect, useState } from 'react';
import { CloseIcon, EditIcon, EqualizerIcon, MusicNoteIcon, PauseIcon, PlayIcon, TrashIcon, UploadIcon } from '../components/icons';
import { OverflowMenu, type MenuAction } from '../components/OverflowMenu';
import { formatDuration } from '../reader/formatDuration';
import { useChapterDetection } from '../settings/useChapterDetection';
import { EDGE_VOICES } from '../tts/edge/EdgeTTSEngine';
import { KOKORO_VOICES } from '../tts/kokoro/KokoroTTSEngine';
import { offlineDownloader, type DownloadJobSnapshot } from '../tts/offlineDownload';
import { thumbColor, thumbInitial } from './DocumentRow';
import { DownloadRangeDialog } from './DownloadRangeDialog';
import { useLibrary } from './LibraryProvider';
import { formatBytes } from './StorageCard';
import { useApproxBookPosition } from './useApproxBookPosition';

interface DownloadRowProps {
  item: AudioItemRecord;
  isPlaying: boolean;
  onPlay: () => void;
  onOpenDocument: (documentId: string, options?: { autoplay?: boolean }) => void;
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

function chapterIndexAt(chapters: ChapterRef[], charOffset: number): number {
  let index = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.charStart <= charOffset) index = i;
    else break;
  }
  return index;
}

// "Ch. 1–15" or (no chapters detected) "p. 1–120, 300–340" — one span per
// merged, disjoint chunkRanges group, per the brief's own example.
function summarizeCoverage(chunkRanges: ChunkIndexRange[], charRanges: { charStart: number; charEnd: number }[], chapters: ChapterRef[], pages: PageRef[]): string | null {
  const merged = mergeChunkRanges(chunkRanges);
  if (merged.length === 0) return null;
  const hasChapters = chapters.length > 0;
  const numbers = merged.map((r) => {
    const charStart = charRanges[r.fromChunkIndex]?.charStart ?? 0;
    const charEnd = charRanges[r.toChunkIndex]?.charEnd ?? 0;
    const lastOffset = Math.max(charStart, charEnd - 1);
    const from = hasChapters ? chapterIndexAt(chapters, charStart) + 1 : findPageIndexAtOffset(pages, charStart) + 1;
    const to = hasChapters ? chapterIndexAt(chapters, lastOffset) + 1 : findPageIndexAtOffset(pages, lastOffset) + 1;
    return from === to ? `${from}` : `${from}–${to}`;
  });
  return (hasChapters ? 'Ch. ' : 'p. ') + numbers.join(', ');
}

// The last (highest) chapter number covered — "Download more…"'s pre-fill,
// per the brief ("opens the dialog starting right after the last saved
// chapter"). null when the book has no detected chapters or no coverage yet.
function lastCoveredChapterNumber(chunkRanges: ChunkIndexRange[], charRanges: { charStart: number; charEnd: number }[], chapters: ChapterRef[]): number | null {
  if (chapters.length === 0) return null;
  const merged = mergeChunkRanges(chunkRanges);
  if (merged.length === 0) return null;
  const maxCharEnd = Math.max(...merged.map((r) => charRanges[r.toChunkIndex]?.charEnd ?? 0));
  return chapterIndexAt(chapters, Math.max(0, maxCharEnd - 1)) + 1;
}

export function DownloadRow({ item, isPlaying, onPlay, onOpenDocument, onRename, onAttachSubtitles, onDelete }: DownloadRowProps) {
  const { repository } = useLibrary();
  const { settings: chapterDetection } = useChapterDetection();
  const bookPosition = useApproxBookPosition(item.documentId, item.positionMs, item.durationMs, chapterDetection);
  const [jobSnapshot, setJobSnapshot] = useState<DownloadJobSnapshot | null>(null);
  const [coverageLabel, setCoverageLabel] = useState<string | null>(null);
  const [startAfterChapter, setStartAfterChapter] = useState<number | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  useEffect(() => {
    if (item.kind !== 'book' || !item.documentId) return;
    return offlineDownloader.subscribe(item.documentId, setJobSnapshot);
  }, [item.kind, item.documentId]);

  // Partial downloads (audioReady:false) don't carry a chapterLabel —
  // derive "Ch. 1–15"/"p. 1–120, 300–340" from chunkRanges instead, the
  // same math the download dialog itself uses.
  useEffect(() => {
    if (item.kind !== 'book' || item.audioReady || !item.documentId || !repository) return;
    let cancelled = false;
    (async () => {
      const doc = await repository.getDocument(item.documentId!);
      if (cancelled || !doc) return;
      const text = await repository.getDocumentText(item.documentId!);
      if (cancelled || text === undefined) return;
      const chunks = buildChunkSequence(doc.structure, text);
      const charRanges = chunkCharRanges(chunks, doc.structure);
      const chapters = detectChapters(text, chapterDetection);
      setCoverageLabel(summarizeCoverage(item.chunkRanges, charRanges, chapters, doc.structure.pages));
      setStartAfterChapter(lastCoveredChapterNumber(item.chunkRanges, charRanges, chapters));
    })();
    return () => {
      cancelled = true;
    };
  }, [item.kind, item.audioReady, item.documentId, item.chunkRanges, repository, chapterDetection]);

  const percent = item.durationMs > 0 ? Math.round((item.positionMs / item.durationMs) * 100) : 0;
  const color = thumbColor(item.title);

  const rangeLabel = item.audioReady ? item.chapterLabel : coverageLabel;
  const detailLine =
    item.kind === 'book'
      ? [rangeLabel, item.voiceURI ? voiceName(item.voiceURI) : null, `${item.rate}×`].filter(Boolean).join(' · ')
      : item.subtitleFilename
        ? `Subtitles: ${item.subtitleFilename}`
        : 'No subtitles';

  const positionLabel =
    item.positionMs <= 0
      ? 'Not started'
      : bookPosition
        ? `Ch. ${bookPosition.chapterNumber} · ${formatDuration(item.positionMs / 1000)}`
        : formatDuration(item.positionMs / 1000);

  const jobStatusLabel = jobSnapshot
    ? jobSnapshot.status === 'downloading'
      ? `Downloading · ${Math.round(jobSnapshot.progress * 100)}%`
      : jobSnapshot.status === 'queued'
        ? 'Queued'
        : jobSnapshot.status === 'paused'
          ? 'Paused'
          : `Failed: ${jobSnapshot.error}`
    : null;

  const menuActions: MenuAction[] = [
    { label: 'Rename', icon: <EditIcon />, onSelect: onRename },
    ...(item.kind === 'book' ? [{ label: 'Download more…', icon: <UploadIcon />, onSelect: () => setDownloadDialogOpen(true) }] : []),
    { label: 'Attach subtitles…', icon: <UploadIcon />, onSelect: onAttachSubtitles },
    { label: 'Delete', icon: <TrashIcon />, onSelect: onDelete, danger: true },
  ];

  function handlePlay() {
    // A book that isn't fully downloaded yet has no single playable blob
    // (see records.ts's audioReady doc comment) — open it in the reader
    // instead, which plays straight from the segment cache (no second
    // pipeline).
    if (item.kind === 'book' && !item.audioReady && item.documentId) {
      onOpenDocument(item.documentId, { autoplay: true });
      return;
    }
    onPlay();
  }

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
      {jobSnapshot ? (
        <div className="doc-row-progress">
          <span className="progress-track">
            <span className="progress-fill" style={{ width: `${jobSnapshot.progress * 100}%` }} />
          </span>
          <span className="doc-row-progress-value doc-row-progress-value-status" title={jobStatusLabel ?? undefined}>
            {jobStatusLabel}
          </span>
        </div>
      ) : (
        <div className="doc-row-progress">
          <span className="progress-track">
            <span className="progress-fill" style={{ width: `${percent}%` }} />
          </span>
          <span className="doc-row-progress-value">{positionLabel}</span>
        </div>
      )}
      <span className="doc-row-length">{formatLengthLabel(item.durationMs)}</span>
      <span className="doc-row-opened">{formatBytes(item.sizeBytes)}</span>
      <div className="doc-row-actions">
        {jobSnapshot && item.documentId ? (
          // Replaces Play/Menu (not alongside them) — this row's actions
          // column is a fixed width shared with every other row in the
          // table, same two-icon-button budget either way.
          <>
            {(jobSnapshot.status === 'downloading' || jobSnapshot.status === 'queued') && (
              <button type="button" className="btn btn-icon" aria-label="Pause download" onClick={() => offlineDownloader.pause(item.documentId!)}>
                <PauseIcon width={14} height={14} />
              </button>
            )}
            {(jobSnapshot.status === 'paused' || jobSnapshot.status === 'error') && (
              <button type="button" className="btn btn-icon" aria-label="Resume download" onClick={() => offlineDownloader.resume(item.documentId!)}>
                <PlayIcon width={14} height={14} />
              </button>
            )}
            <button type="button" className="btn btn-icon" aria-label="Cancel download" onClick={() => offlineDownloader.cancel(item.documentId!)}>
              <CloseIcon width={14} height={14} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`doc-row-play${item.positionMs > 0 ? ' doc-row-play-active' : ''}`}
              aria-label={isPlaying ? 'Pause' : item.positionMs > 0 ? 'Resume' : 'Play'}
              onClick={handlePlay}
            >
              {isPlaying ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
            </button>
            <OverflowMenu actions={menuActions} label={`More actions for ${item.title}`} />
          </>
        )}
      </div>
      {downloadDialogOpen && item.documentId && (
        <DownloadRangeDialog
          documentId={item.documentId}
          startAfterChapterNumber={startAfterChapter ?? undefined}
          onClose={() => setDownloadDialogOpen(false)}
        />
      )}
    </div>
  );
}
