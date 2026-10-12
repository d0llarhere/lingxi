import type { PlaybackState, VoiceInfo } from '@lingxi/core';
import { DownloadIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, StopIcon } from '../components/icons';
import { EDGE_VOICE_PREFIX, EDGE_VOICES, type AriaWakeStatus } from '../tts/edge/EdgeTTSEngine';
import type { KokoroStatusSnapshot } from '../tts/kokoro/KokoroTTSEngine';
import { KOKORO_VOICE_PREFIX, KOKORO_VOICES } from '../tts/kokoro/KokoroTTSEngine';
import type { OfflineDownloadSnapshot } from '../tts/offlineDownload';
import { formatDuration } from './formatDuration';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

// A rough, unvalidated reading-aloud rate at 1x, used only to turn character
// counts into a displayed time estimate — not calibrated per voice/engine
// the way WebSpeechTTSEngine's own estimator is (that one tracks real
// utterance durations for its position fallback; this is a much coarser
// "roughly how long is this book" display, so a shared constant is enough).
// Matches WebSpeechTTSEngine's seed value for consistency, not because the
// two are coupled.
const ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 = 17;

interface PlaybackControlsProps {
  state: PlaybackState;
  progress: number;
  rate: number;
  voices: VoiceInfo[];
  voicesLoading: boolean;
  voiceURI: string | null;
  kokoroStatus: KokoroStatusSnapshot;
  offlineDownloadStatus: OfflineDownloadSnapshot;
  ariaWakeStatus: AriaWakeStatus;
  cacheStatus: { fullyCached: boolean; allAria: boolean } | null;
  approximateHighlighting: boolean;
  currentPage: number | null;
  totalPages: number;
  currentCharOffset: number;
  totalChars: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voiceURI: string | null) => void;
  onDownloadKokoro: () => void;
  onDownloadOffline: () => void;
  onExportAudio: () => void;
  onExportSrt: () => void;
  onSeek: (fraction: number) => void;
}

export function PlaybackControls({
  state,
  progress,
  rate,
  voices,
  voicesLoading,
  voiceURI,
  kokoroStatus,
  offlineDownloadStatus,
  ariaWakeStatus,
  cacheStatus,
  approximateHighlighting,
  currentPage,
  totalPages,
  currentCharOffset,
  totalChars,
  onPlay,
  onPause,
  onStop,
  onPrevious,
  onNext,
  onRateChange,
  onVoiceChange,
  onDownloadKokoro,
  onDownloadOffline,
  onExportAudio,
  onExportSrt,
  onSeek,
}: PlaybackControlsProps) {
  const percent = Math.round(progress * 100);
  const isPlaying = state === 'playing';
  // Recomputed from `rate` on every render, so changing speed immediately
  // updates both numbers — not just the total, which would otherwise look
  // wrong relative to an elapsed time still reflecting the old speed.
  const charsPerSecond = ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 * rate;
  const elapsedLabel = formatDuration(currentCharOffset / charsPerSecond);
  const totalLabel = formatDuration(totalChars / charsPerSecond);
  const browserVoices = voices.filter(
    (voice) => !voice.voiceURI.startsWith(KOKORO_VOICE_PREFIX) && !voice.voiceURI.startsWith(EDGE_VOICE_PREFIX),
  );
  const isKokoroSelected = voiceURI?.startsWith(KOKORO_VOICE_PREFIX) ?? false;
  const isAriaSelected = voiceURI?.startsWith(EDGE_VOICE_PREFIX) ?? false;
  // Only kokoro:/edge: voices can be cached at all — WebSpeech exposes no
  // audio stream to capture (see CachingTTSEngine.ts).
  const isCacheableVoice = isKokoroSelected || isAriaSelected;

  return (
    <div className="playback-bar">
      {isAriaSelected && ariaWakeStatus === 'waking' && (
        <p className="approximate-note">Waking up Aria… the server went idle and takes up to a minute to start.</p>
      )}

      {approximateHighlighting && (
        <p className="approximate-note">Word highlighting is approximate on this browser/voice.</p>
      )}

      <div className="playback-progress-row">
        <label className="visually-hidden" htmlFor="progress-bar">
          Reading progress
        </label>
        <input
          id="progress-bar"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <span className="playback-progress-label">
          {percent}%{currentPage && totalPages > 1 ? ` · p.${currentPage}/${totalPages}` : ''}
        </span>
      </div>

      <div className="playback-controls-row">
        <span className="playback-time" aria-live="off">
          <span className="visually-hidden">Elapsed / total estimated time</span>
          <span aria-hidden="true">
            {elapsedLabel} / ~{totalLabel}
          </span>
        </span>

        <div className="playback-transport">
          <button type="button" className="btn btn-icon" onClick={onPrevious} aria-label="Previous sentence">
            <PreviousIcon />
          </button>
          <button
            type="button"
            className="btn btn-play"
            onClick={isPlaying ? onPause : onPlay}
            aria-label={isPlaying ? 'Pause' : state === 'paused' ? 'Resume' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="btn btn-icon" onClick={onNext} aria-label="Next sentence">
            <NextIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={onStop}
            disabled={state === 'idle'}
            aria-label="Stop"
          >
            <StopIcon />
          </button>
        </div>

        <div className="playback-secondary">
          <div className="speed-control" role="group" aria-label="Playback speed">
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`speed-option${rate === option ? ' is-active' : ''}`}
                onClick={() => onRateChange(option)}
              >
                {option}x
              </button>
            ))}
          </div>

          <select
            className="select voice-select"
            aria-label="Voice"
            value={voiceURI ?? ''}
            disabled={voicesLoading}
            onChange={(e) => onVoiceChange(e.target.value || null)}
          >
            <option value="">Default voice</option>
            {voicesLoading && <option disabled>Loading voices…</option>}
            <optgroup label="Local voices (offline)">
              {KOKORO_VOICES.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Premium voices (online)">
              {EDGE_VOICES.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang}) · requires network
                </option>
              ))}
            </optgroup>
            <optgroup label="Browser voices">
              {browserVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang}){voice.localService ? '' : ' · requires network'}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {(isKokoroSelected || kokoroStatus.status === 'downloading' || kokoroStatus.status === 'error') && (
        <div className="local-voice-status">
          {kokoroStatus.status === 'ready' && <span className="local-voice-status-ok">✓ Local voice ready (offline)</span>}

          {kokoroStatus.status === 'not-downloaded' && (
            <>
              <span>Local voice model not downloaded yet</span>
              <button type="button" className="btn" onClick={onDownloadKokoro}>
                Download Kokoro
              </button>
            </>
          )}

          {kokoroStatus.status === 'downloading' && (
            <>
              <span>Downloading local voice model… {Math.round(kokoroStatus.progress * 100)}%</span>
              <progress className="local-voice-progress" value={kokoroStatus.progress} max={1} />
            </>
          )}

          {kokoroStatus.status === 'error' && (
            <>
              <span className="error-message">Download failed: {kokoroStatus.error}</span>
              <button type="button" className="btn" onClick={onDownloadKokoro}>
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {isCacheableVoice && (
        <div className="local-voice-status">
          {offlineDownloadStatus.status === 'ready' && (
            <span className="local-voice-status-ok">✓ Downloaded for offline playback</span>
          )}

          {offlineDownloadStatus.status === 'not-started' && (
            <>
              <span>Not yet downloaded for offline playback</span>
              <button type="button" className="btn" onClick={onDownloadOffline}>
                <DownloadIcon /> Download for offline
              </button>
            </>
          )}

          {offlineDownloadStatus.status === 'downloading' && (
            <>
              <span>Downloading for offline… {Math.round(offlineDownloadStatus.progress * 100)}%</span>
              <progress className="local-voice-progress" value={offlineDownloadStatus.progress} max={1} />
            </>
          )}

          {offlineDownloadStatus.status === 'error' && (
            <>
              <span className="error-message">Download failed: {offlineDownloadStatus.error}</span>
              <button type="button" className="btn" onClick={onDownloadOffline}>
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {isCacheableVoice && cacheStatus?.fullyCached && (
        <div className="local-voice-status">
          <button type="button" className="btn btn-secondary" onClick={onExportAudio}>
            <DownloadIcon /> Export {cacheStatus.allAria ? 'MP3' : 'WAV'}
          </button>
          {cacheStatus.allAria && (
            <button type="button" className="btn btn-secondary" onClick={onExportSrt}>
              <DownloadIcon /> Export subtitles (.srt)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
