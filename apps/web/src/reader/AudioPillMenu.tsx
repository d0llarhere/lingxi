import { useEffect, useRef } from 'react';
import { MoonIcon, SubtitlesIcon, UploadIcon } from '../components/icons';

// Mirrors PlaybackMenu's rate-stepper range — see that file's own comment.
const MIN_RATE = 0.5;
const MAX_RATE = 3;
const RATE_STEP = 0.05;

export type AudioSleepTimerChoice = 'off' | 15 | 30 | 45 | 60 | 'end-of-track';

const SLEEP_TIMER_OPTIONS: { choice: AudioSleepTimerChoice; label: string }[] = [
  { choice: 'off', label: 'Off' },
  { choice: 15, label: '15 min' },
  { choice: 30, label: '30 min' },
  { choice: 45, label: '45 min' },
  { choice: 60, label: '60 min' },
  { choice: 'end-of-track', label: 'End of track' },
];

interface AudioPillMenuProps {
  onClose: () => void;
  rate: number;
  onRateChange: (rate: number) => void;
  subtitlesOn: boolean;
  subtitleFilename: string | null;
  onToggleSubtitles: () => void;
  onImportSubtitles: () => void;
  sleepTimerLabel: string;
  onSetSleepTimer: (choice: AudioSleepTimerChoice) => void;
}

// Same menu shell/rows as the reader's PlaybackMenu (.pill-menu/.pill-mi —
// see reader.css), just with an audio-file-specific row set: no voice
// picker or offline-download row (both reader-only concepts), a Subtitles
// on/off switch instead.
export function AudioPillMenu({
  onClose,
  rate,
  onRateChange,
  subtitlesOn,
  subtitleFilename,
  onToggleSubtitles,
  onImportSubtitles,
  sleepTimerLabel,
  onSetSleepTimer,
}: AudioPillMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
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

  function selectSleepTimer(choice: AudioSleepTimerChoice) {
    onSetSleepTimer(choice);
    onClose();
  }

  return (
    <div ref={panelRef} role="menu" aria-label="Playback options" className="pill-menu">
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

      <button type="button" role="menuitem" className="pill-mi" onClick={onToggleSubtitles}>
        <span className="pill-mi-icon">
          <SubtitlesIcon width={16} height={16} />
        </span>
        <span className="pill-mi-text">
          Subtitles
          <span className="pill-mi-sub">
            {subtitlesOn ? 'On' : 'Off'} {subtitleFilename ? `· ${subtitleFilename}` : ''}
          </span>
        </span>
        <span
          role="switch"
          aria-checked={subtitlesOn}
          aria-label="Show subtitles"
          className={`pill-switch${subtitlesOn ? ' pill-switch-on' : ''}`}
        >
          <span className="pill-switch-thumb" />
        </span>
      </button>

      <button type="button" role="menuitem" className="pill-mi" onClick={onImportSubtitles}>
        <span className="pill-mi-icon">
          <UploadIcon width={16} height={16} />
        </span>
        <span className="pill-mi-text">
          Import subtitles…
          <span className="pill-mi-sub">.srt or .vtt for this audio</span>
        </span>
      </button>

      <div className="pill-menu-divider" />

      <div className="pill-menu-row">
        <span className="pill-mi-icon">
          <MoonIcon width={16} height={16} />
        </span>
        <span className="pill-menu-row-label">Sleep timer</span>
      </div>
      {SLEEP_TIMER_OPTIONS.map((option) => {
        const isActive = sleepTimerLabel.startsWith(option.label);
        return (
          <button
            key={option.choice}
            type="button"
            role="menuitem"
            className={`pill-mi${isActive ? ' pill-mi-selected' : ''}`}
            onClick={() => selectSleepTimer(option.choice)}
          >
            <span className="pill-mi-text">
              {option.label}
              {/* Fixed-minute choices show a static label only, same as the
                  reader's own sleep timer — only "End of track" has no fixed
                  deadline to summarize, so it's the one choice that needs a
                  live countdown instead. */}
              {isActive && option.choice === 'end-of-track' && (
                <span className="pill-mi-sub">{sleepTimerLabel.replace(/^End of track\s*·\s*/, '')}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
