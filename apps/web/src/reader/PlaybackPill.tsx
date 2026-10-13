import type { PlaybackState, VoiceInfo } from '@lingxi/core';
import { MoreHorizontalIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from '../components/icons';
import type { KokoroStatusSnapshot } from '../tts/kokoro/KokoroTTSEngine';
import type { OfflineDownloadSnapshot } from '../tts/offlineDownload';
import { formatDuration } from './formatDuration';
import { PlaybackMenu, type SleepTimerChoice } from './PlaybackMenu';
import { useAutoCollapse } from './useAutoCollapse';

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export interface PlaybackPillProps {
  state: PlaybackState;
  // Chapter-scoped fraction (0..1) for the progress ring — falls back to
  // whole-document progress when the book has no detected chapters (see
  // ReaderScreen's chapter derivation).
  progress: number;
  rate: number;
  chapterNumber: number | null;
  chapterTitle: string | null;
  paragraphNumber: number;
  totalParagraphs: number;
  currentPage: number | null;
  totalPages: number;
  // null when there's no "next chapter" to measure against (last chapter,
  // or no chapters detected at all).
  remainingInChapterSeconds: number | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onPlay: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRateChange: (rate: number) => void;
  voices: VoiceInfo[];
  voiceURI: string | null;
  onVoiceChange: (voiceURI: string | null) => void;
  onPreviewVoice: (voiceURI: string) => void;
  sleepTimerLabel: string;
  onSetSleepTimer: (choice: SleepTimerChoice) => void;
  kokoroStatus: KokoroStatusSnapshot;
  onDownloadKokoro: () => void;
  offlineDownloadStatus: OfflineDownloadSnapshot;
  onDownloadOffline: () => void;
  cacheStatus: { fullyCached: boolean; allAria: boolean } | null;
  onExportAudio: () => void;
  onExportSrt: () => void;
}

function cycleSpeed(current: number): number {
  const index = SPEED_OPTIONS.indexOf(current);
  const next = index === -1 ? 0 : (index + 1) % SPEED_OPTIONS.length;
  return SPEED_OPTIONS[next]!;
}

// Ring stroke-dasharray trick: a circle's path length equals its own
// circumference, so "X on, C off" (C = circumference) draws exactly one
// arc of length X before the dash pattern would repeat — never gets the
// chance to, since the path ends there. X = progress fraction * C.
function ringDashArray(progress: number, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const dash = Math.max(0, Math.min(1, progress)) * circumference;
  return `${dash} ${circumference}`;
}

function PlayButton({ playing, progress, size, onClick }: { playing: boolean; progress: number; size: 36 | 48; onClick: () => void }) {
  const radius = size === 48 ? 20.5 : 15.5;
  const strokeWidth = size === 48 ? 3 : 2.5;
  const iconSize = size === 48 ? 18 : 14;
  const half = size / 2;

  return (
    <button
      type="button"
      className="pill-play"
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="pill-play-ring">
        <circle cx={half} cy={half} r={radius + 1.5} fill="var(--accent)" />
        {playing && size === 48 && (
          <circle
            cx={half}
            cy={half}
            r={radius}
            fill="none"
            stroke="var(--on-accent)"
            strokeWidth={strokeWidth}
            strokeOpacity={0.22}
          />
        )}
        {playing && (
          <circle
            cx={half}
            cy={half}
            r={radius}
            fill="none"
            stroke="var(--on-accent)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={ringDashArray(progress, radius)}
            transform={`rotate(-90 ${half} ${half})`}
          />
        )}
      </svg>
      <span className="pill-play-icon">
        {playing ? <PauseIcon width={iconSize} height={iconSize} /> : <PlayIcon width={iconSize} height={iconSize} />}
      </span>
    </button>
  );
}

export function PlaybackPill({
  state,
  progress,
  rate,
  chapterNumber,
  chapterTitle,
  paragraphNumber,
  totalParagraphs,
  currentPage,
  totalPages,
  remainingInChapterSeconds,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onPlay,
  onPause,
  onPrevious,
  onNext,
  onRateChange,
  voices,
  voiceURI,
  onVoiceChange,
  onPreviewVoice,
  sleepTimerLabel,
  onSetSleepTimer,
  kokoroStatus,
  onDownloadKokoro,
  offlineDownloadStatus,
  onDownloadOffline,
  cacheStatus,
  onExportAudio,
  onExportSrt,
}: PlaybackPillProps) {
  const isPlaying = state === 'playing';
  const isPaused = state === 'paused';
  const collapsed = useAutoCollapse(isPlaying) && !isPaused;

  const hasChapters = chapterNumber !== null;
  const positionLabel = hasChapters ? `Ch. ${chapterNumber}` : `¶ ${paragraphNumber} of ${totalParagraphs}`;
  const pageLabel = currentPage && totalPages > 1 ? `p. ${currentPage} / ${totalPages}` : '';
  const remainingLabel = remainingInChapterSeconds !== null ? `${formatDuration(remainingInChapterSeconds)} left` : '';
  const line2 = [pageLabel, remainingLabel].filter(Boolean).join(' · ');

  if (collapsed) {
    const collapsedLabel = hasChapters && pageLabel ? `${positionLabel} · ${pageLabel}` : positionLabel;
    return (
      <div className="pill pill-collapsed">
        <PlayButton playing={isPlaying} progress={progress} size={36} onClick={isPlaying ? onPause : onPlay} />
        <span className="pill-collapsed-label">{collapsedLabel}</span>
      </div>
    );
  }

  return (
    <div className="pill-anchor">
      {menuOpen && (
        <div className="pill-menu-anchor">
          <PlaybackMenu
            onClose={onCloseMenu}
            rate={rate}
            onRateChange={onRateChange}
            voices={voices}
            voiceURI={voiceURI}
            onVoiceChange={onVoiceChange}
            onPreviewVoice={onPreviewVoice}
            sleepTimerLabel={sleepTimerLabel}
            onSetSleepTimer={onSetSleepTimer}
            kokoroStatus={kokoroStatus}
            onDownloadKokoro={onDownloadKokoro}
            offlineDownloadStatus={offlineDownloadStatus}
            onDownloadOffline={onDownloadOffline}
            cacheStatus={cacheStatus}
            onExportAudio={onExportAudio}
            onExportSrt={onExportSrt}
          />
        </div>
      )}
      <div className="pill">
        <button type="button" className="pill-icon-btn" onClick={onPrevious} aria-label="Previous paragraph">
          <PreviousIcon width={18} height={18} />
        </button>
        <PlayButton playing={isPlaying} progress={progress} size={48} onClick={isPlaying ? onPause : onPlay} />
        <button type="button" className="pill-icon-btn" onClick={onNext} aria-label="Next paragraph">
          <NextIcon width={18} height={18} />
        </button>

        <div className="pill-divider" />

        <div className="pill-info">
          <div className="pill-info-line1">
            {isPaused ? (
              <>
                Paused <span className="pill-info-dot">·</span> {positionLabel}
              </>
            ) : hasChapters ? (
              <>
                {positionLabel} <span className="pill-info-dot">·</span> {chapterTitle}
              </>
            ) : (
              positionLabel
            )}
          </div>
          {line2 && <div className="pill-info-line2">{line2}</div>}
        </div>

        <button
          type="button"
          className="pill-speed-chip"
          onClick={() => onRateChange(cycleSpeed(rate))}
          aria-label={`Playback speed ${rate}×`}
        >
          {rate}×
        </button>

        <button
          type="button"
          className="pill-icon-btn"
          onClick={onToggleMenu}
          aria-label="Playback options"
          aria-expanded={menuOpen}
        >
          <MoreHorizontalIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}
