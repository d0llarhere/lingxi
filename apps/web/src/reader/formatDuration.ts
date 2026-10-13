// A rough, unvalidated reading-aloud rate at 1x, used only to turn character
// counts into a displayed time estimate — not calibrated per voice/engine
// the way WebSpeechTTSEngine's own estimator is (that one tracks real
// utterance durations for its position fallback; this is a much coarser
// "roughly how long is this book/chapter" display). Shared by the playback
// timeline and the pill player's "remaining in chapter" readout so there's
// one estimate, not two that could drift apart.
export const ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 = 17;

// Formats a duration in seconds as "M:SS" (under an hour) or "H:MM:SS" —
// shared by the playback timeline's elapsed/total readout and the offline
// download's remaining-time estimate.
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
