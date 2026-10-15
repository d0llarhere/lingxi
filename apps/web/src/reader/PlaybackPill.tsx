import type { PlaybackState, VoiceInfo } from '@lingxi/core';
import { MoreHorizontalIcon, NextIcon, PreviousIcon } from '../components/icons';
import type { KokoroStatusSnapshot } from '../tts/kokoro/KokoroTTSEngine';
import type { OfflineDownloadSnapshot } from '../tts/offlineDownload';
import { formatDuration } from './formatDuration';
import { PlaybackMenu, type SleepTimerChoice } from './PlaybackMenu';
import { cycleSpeed, PlayButton } from './pillPrimitives';
import { useAutoCollapse } from './useAutoCollapse';

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
