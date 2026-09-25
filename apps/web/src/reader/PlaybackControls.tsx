import type { PlaybackState, VoiceInfo } from '@lingxi/core';

interface PlaybackControlsProps {
  state: PlaybackState;
  progress: number;
  rate: number;
  voices: VoiceInfo[];
  voiceURI: string | null;
  approximateHighlighting: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voiceURI: string | null) => void;
  onSeek: (fraction: number) => void;
}

export function PlaybackControls({
  state,
  progress,
  rate,
  voices,
  voiceURI,
  approximateHighlighting,
  onPlay,
  onPause,
  onStop,
  onPrevious,
  onNext,
  onRateChange,
  onVoiceChange,
  onSeek,
}: PlaybackControlsProps) {
  return (
    <div>
      <div>
        <button onClick={onPrevious}>Previous sentence</button>
        <button onClick={onPlay} disabled={state === 'playing'}>
          {state === 'paused' ? 'Resume' : 'Play'}
        </button>
        <button onClick={onPause} disabled={state !== 'playing'}>
          Pause
        </button>
        <button onClick={onStop} disabled={state === 'idle'}>
          Stop
        </button>
        <button onClick={onNext}>Next sentence</button>
      </div>

      <div>
        <label htmlFor="progress-bar">Progress</label>
        <input
          id="progress-bar"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>

      <div>
        <label htmlFor="speed-control">Speed: {rate.toFixed(1)}x</label>
        <input
          id="speed-control"
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={rate}
          onChange={(e) => onRateChange(Number(e.target.value))}
        />
      </div>

      <div>
        <label htmlFor="voice-select">Voice</label>
        <select id="voice-select" value={voiceURI ?? ''} onChange={(e) => onVoiceChange(e.target.value || null)}>
          <option value="">Default</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </div>

      {approximateHighlighting && (
        <p>Word highlighting is approximate on this browser/voice (no word-boundary events available).</p>
      )}
    </div>
  );
}
