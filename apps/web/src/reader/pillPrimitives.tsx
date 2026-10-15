import { PauseIcon, PlayIcon } from '../components/icons';

// Shared by the reader's PlaybackPill and the Downloads page's AudioPill —
// same mini pill component in two variants (word-cursor-driven vs
// time-cursor-driven), but the play button/ring and speed cycling are
// identical either way.

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function cycleSpeed(current: number): number {
  const index = SPEED_OPTIONS.indexOf(current);
  const next = index === -1 ? 0 : (index + 1) % SPEED_OPTIONS.length;
  return SPEED_OPTIONS[next]!;
}

// Ring stroke-dasharray trick: a circle's path length equals its own
// circumference, so "X on, C off" (C = circumference) draws exactly one
// arc of length X before the dash pattern would repeat — never gets the
// chance to, since the path ends there. X = progress fraction * C.
export function ringDashArray(progress: number, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const dash = Math.max(0, Math.min(1, progress)) * circumference;
  return `${dash} ${circumference}`;
}

export function PlayButton({
  playing,
  progress,
  size,
  onClick,
}: {
  playing: boolean;
  progress: number;
  size: 36 | 48;
  onClick: () => void;
}) {
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
