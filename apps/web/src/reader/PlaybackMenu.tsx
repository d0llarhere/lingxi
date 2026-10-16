import type { VoiceInfo } from '@lingxi/core';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MoonIcon, PlayIcon } from '../components/icons';
import { EDGE_VOICE_PREFIX } from '../tts/edge/EdgeTTSEngine';
import { KOKORO_VOICE_PREFIX } from '../tts/kokoro/KokoroTTSEngine';
import type { KokoroStatusSnapshot } from '../tts/kokoro/KokoroTTSEngine';
import type { DownloadJobSnapshot } from '../tts/offlineDownload';

// Mirrors PlaybackController's own clamp range (see playbackController.ts) —
// not exported from core since this is the brief's UI-level stepper range,
// not something the controller needs to expose; setSpeed() clamps anyway,
// so a UI mismatch here could never put playback out of range.
const MIN_RATE = 0.5;
const MAX_RATE = 3;
const RATE_STEP = 0.05;

export type SleepTimerChoice = 'off' | 15 | 30 | 45 | 60 | 'end-of-chapter';

const SLEEP_TIMER_OPTIONS: { choice: SleepTimerChoice; label: string }[] = [
  { choice: 'off', label: 'Off' },
  { choice: 15, label: '15 min' },
  { choice: 30, label: '30 min' },
  { choice: 45, label: '45 min' },
  { choice: 60, label: '60 min' },
  { choice: 'end-of-chapter', label: 'End of chapter' },
];

interface PlaybackMenuProps {
  onClose: () => void;
  rate: number;
  onRateChange: (rate: number) => void;
  voices: VoiceInfo[];
  voiceURI: string | null;
  onVoiceChange: (voiceURI: string | null) => void;
  onPreviewVoice: (voiceURI: string) => void;
  sleepTimerLabel: string;
  onSetSleepTimer: (choice: SleepTimerChoice) => void;
  kokoroStatus: KokoroStatusSnapshot;
  onDownloadKokoro: () => void;
  offlineDownloadStatus: DownloadJobSnapshot | null;
  onDownloadOffline: () => void;
  // Only offered once the whole book is cached for the selected voice (see
  // CachingTTSEngine) — same gating the old PlaybackControls bar used.
  cacheStatus: { fullyCached: boolean; allAria: boolean } | null;
  onExportAudio: () => void;
  onExportSrt: () => void;
}

type MenuView = 'main' | 'voice' | 'sleep';

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function PlaybackMenu({
  onClose,
  rate,
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
}: PlaybackMenuProps) {
  const [view, setView] = useState<MenuView>('main');
  const [kokoroCancelled, setKokoroCancelled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kokoroStatus.status !== 'downloading') setKokoroCancelled(false);
  }, [kokoroStatus.status]);

  // Esc / outside click closes the whole menu, regardless of which view is
  // showing — matches the brief ("Close the menu on Esc, an outside click
  // or a selection").
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;
      const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const nextIndex =
        currentIndex === -1
          ? 0
          : e.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onClose]);

  const isKokoroReady = kokoroStatus.status === 'ready';
  const selectedVoice = voices.find((v) => v.voiceURI === voiceURI) ?? null;
  const voiceSubtitle = selectedVoice ? (selectedVoice.localService ? 'on-device' : 'needs internet') : 'System default';
  const isCacheableVoice = voiceURI?.startsWith(KOKORO_VOICE_PREFIX) || voiceURI?.startsWith(EDGE_VOICE_PREFIX);

  function selectVoice(uri: string | null) {
    onVoiceChange(uri);
    setView('main');
    onClose();
  }

  function selectSleepTimer(choice: SleepTimerChoice) {
    onSetSleepTimer(choice);
    setView('main');
    onClose();
  }

  return (
    <div ref={panelRef} role="menu" aria-label="Playback options" className="pill-menu">
      {view === 'main' && (
        <>
          <div className="pill-menu-row pill-menu-stepper">
            <span className="pill-menu-row-label">Speed</span>
            <button
              type="button"
              className="pill-step-btn"
              aria-label="Slower"
              onClick={() => onRateChange(Math.max(MIN_RATE, Math.round((rate - RATE_STEP) * 100) / 100))}
              disabled={rate <= MIN_RATE}
            >
              −
            </button>
            <span className="pill-step-value">{rate.toFixed(2)}×</span>
            <button
              type="button"
              className="pill-step-btn"
              aria-label="Faster"
              onClick={() => onRateChange(Math.min(MAX_RATE, Math.round((rate + RATE_STEP) * 100) / 100))}
              disabled={rate >= MAX_RATE}
            >
              +
            </button>
          </div>

          <button type="button" role="menuitem" className="pill-mi" onClick={() => setView('voice')}>
            <span className="pill-mi-icon pill-mi-avatar">{selectedVoice ? avatarInitial(selectedVoice.name) : '•'}</span>
            <span className="pill-mi-text">
              Voice
              <span className="pill-mi-sub">
                {selectedVoice ? selectedVoice.name : 'Default'} · {voiceSubtitle}
              </span>
            </span>
            <ChevronRightIcon width={16} height={16} className="pill-mi-chevron" />
          </button>

          <button type="button" role="menuitem" className="pill-mi" onClick={() => setView('sleep')}>
            <span className="pill-mi-icon">
              <MoonIcon width={16} height={16} />
            </span>
            <span className="pill-mi-text">
              Sleep timer
              <span className="pill-mi-sub">{sleepTimerLabel}</span>
            </span>
            <ChevronRightIcon width={16} height={16} className="pill-mi-chevron" />
          </button>

          <div className="pill-menu-divider" />

          {isCacheableVoice ? (
            <button type="button" role="menuitem" className="pill-mi" onClick={onDownloadOffline}>
              <span className="pill-mi-icon">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">
                Download for offline
                <span className="pill-mi-sub">
                  {!offlineDownloadStatus && 'Not downloaded'}
                  {offlineDownloadStatus?.status === 'queued' && 'Queued'}
                  {offlineDownloadStatus?.status === 'paused' && 'Paused'}
                  {offlineDownloadStatus?.status === 'downloading' && `Downloading · ${Math.round(offlineDownloadStatus.progress * 100)}%`}
                  {offlineDownloadStatus?.status === 'error' && `Failed: ${offlineDownloadStatus.error}`}
                </span>
              </span>
              {offlineDownloadStatus?.status === 'downloading' && (
                <div className="pill-mi-progress">
                  <div className="pill-mi-progress-fill" style={{ width: `${offlineDownloadStatus.progress * 100}%` }} />
                </div>
              )}
            </button>
          ) : (
            // Only kokoro:/edge: voices can be cached (WebSpeech exposes no
            // audio stream to capture — see CachingTTSEngine.ts), so with
            // the default/System voice selected there's genuinely nothing
            // to download yet. Shown disabled rather than hidden outright —
            // hiding it entirely left the row looking "missing" whenever no
            // voice had been explicitly picked, which is the common case on
            // first opening a book.
            <div className="pill-mi pill-mi-static" aria-disabled="true">
              <span className="pill-mi-icon">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">
                Download for offline
                <span className="pill-mi-sub">Select an on-device or Aria voice to enable</span>
              </span>
            </div>
          )}

          {isCacheableVoice && cacheStatus?.fullyCached && (
            <button type="button" role="menuitem" className="pill-mi" onClick={onExportAudio}>
              <span className="pill-mi-icon">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">Export {cacheStatus.allAria ? 'MP3' : 'WAV'}</span>
            </button>
          )}

          {isCacheableVoice && cacheStatus?.fullyCached && cacheStatus.allAria && (
            <button type="button" role="menuitem" className="pill-mi" onClick={onExportSrt}>
              <span className="pill-mi-icon">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">Export subtitles (.srt)</span>
            </button>
          )}

          {!isKokoroReady && kokoroStatus.status === 'downloading' && !kokoroCancelled && (
            <div className="pill-mi pill-mi-static">
              <span className="pill-mi-icon pill-mi-icon-warn">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">
                Getting Kokoro
                <span className="pill-mi-sub">{Math.round(kokoroStatus.progress * 100)}% · keep this tab open</span>
              </span>
              <button type="button" className="pill-mi-action" onClick={() => setKokoroCancelled(true)}>
                Cancel
              </button>
              <div className="pill-mi-progress pill-mi-progress-warn">
                <div className="pill-mi-progress-fill" style={{ width: `${kokoroStatus.progress * 100}%` }} />
              </div>
            </div>
          )}

          {!isKokoroReady && (kokoroStatus.status === 'not-downloaded' || kokoroStatus.status === 'error' || kokoroCancelled) && (
            <div className="pill-mi pill-mi-static">
              <span className="pill-mi-icon pill-mi-icon-warn">
                <DownloadIcon width={16} height={16} />
              </span>
              <span className="pill-mi-text">
                On-device voices
                <span className="pill-mi-sub">
                  {kokoroStatus.status === 'error' ? `Failed: ${kokoroStatus.error}` : 'Kokoro model not installed'}
                </span>
              </span>
              <button type="button" className="pill-mi-action pill-mi-action-warn" onClick={onDownloadKokoro}>
                Get
              </button>
            </div>
          )}

          <div className="pill-menu-divider" />

          <div className="pill-menu-footer">
            <span>
              <kbd className="pill-kbd">Space</kbd> play
            </span>
            <span>
              <kbd className="pill-kbd">←</kbd> <kbd className="pill-kbd">→</kbd> paragraph
            </span>
            <span>
              <kbd className="pill-kbd">[</kbd> <kbd className="pill-kbd">]</kbd> speed
            </span>
          </div>
        </>
      )}

      {view === 'voice' && (
        <>
          <div className="pill-menu-subheader">
            <button type="button" className="pill-back-btn" aria-label="Back" onClick={() => setView('main')}>
              <ChevronLeftIcon width={16} height={16} />
            </button>
            <span className="pill-menu-subheader-title">Voice</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className={`pill-mi${voiceURI === null ? ' pill-mi-selected' : ''}`}
            onClick={() => selectVoice(null)}
          >
            <span className="pill-mi-icon pill-mi-avatar">•</span>
            <span className="pill-mi-text">Default voice</span>
          </button>
          {voices.map((voice) => (
            // A <div role="menuitem"> wrapper, not a <button> — the row
            // holds two independent actionable buttons (select, preview)
            // and buttons can't nest (confirmed live: React warned about
            // invalid DOM nesting, which also meant the preview button's
            // click/keyboard behavior was unreliable inside another button).
            <div key={voice.voiceURI} role="menuitem" className={`pill-mi${voiceURI === voice.voiceURI ? ' pill-mi-selected' : ''}`}>
              <button type="button" className="pill-mi-select" onClick={() => selectVoice(voice.voiceURI)}>
                <span className="pill-mi-icon pill-mi-avatar">{avatarInitial(voice.name)}</span>
                <span className="pill-mi-text">
                  {voice.name}
                  <span className="pill-mi-sub">{voice.localService ? 'On-device' : 'Needs internet'}</span>
                </span>
              </button>
              <button
                type="button"
                className="pill-preview-btn"
                aria-label={`Preview ${voice.name}`}
                onClick={() => onPreviewVoice(voice.voiceURI)}
              >
                <PlayIcon width={12} height={12} />
              </button>
            </div>
          ))}
        </>
      )}

      {view === 'sleep' && (
        <>
          <div className="pill-menu-subheader">
            <button type="button" className="pill-back-btn" aria-label="Back" onClick={() => setView('main')}>
              <ChevronLeftIcon width={16} height={16} />
            </button>
            <span className="pill-menu-subheader-title">Sleep timer</span>
          </div>
          {SLEEP_TIMER_OPTIONS.map((option) => (
            <button
              key={option.choice}
              type="button"
              role="menuitem"
              className={`pill-mi${sleepTimerLabel === option.label ? ' pill-mi-selected' : ''}`}
              onClick={() => selectSleepTimer(option.choice)}
            >
              <span className="pill-mi-text">{option.label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
