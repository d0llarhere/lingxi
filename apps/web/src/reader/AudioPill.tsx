import { parseSubtitleFile, type AudioItemRecord, type SubtitleCue } from '@lingxi/core';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CloseIcon, ForwardIcon, MoreHorizontalIcon, RewindIcon } from '../components/icons';
import { getAudioLibraryRepository } from '../library/audioLibraryInstance';
import { useApproxBookPosition } from '../library/useApproxBookPosition';
import { useChapterDetection } from '../settings/useChapterDetection';
import { AudioPillMenu, type AudioSleepTimerChoice } from './AudioPillMenu';
import { formatDuration } from './formatDuration';
import { cycleSpeed, PlayButton } from './pillPrimitives';

const PERSIST_INTERVAL_MS = 5000;
const SKIP_SECONDS = 15;
const SEEK_KEY_STEP_MS = 5000;

type SleepTimer = { type: 'minutes'; label: string; firesAt: number } | { type: 'end-of-track' } | null;

interface AudioPillProps {
  item: AudioItemRecord;
  onClose: () => void;
  // Lets DownloadsScreen refresh its row list (position/rate/subtitles) once
  // this pill has actually persisted something, rather than polling.
  onPersisted: () => void;
}

function SeekBar({
  currentMs,
  durationMs,
  onSeek,
}: {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const percent = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  function seekFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track || durationMs <= 0) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(Math.round(fraction * durationMs));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    seekFromClientX(e.clientX);
    const handleMove = (moveEvent: PointerEvent) => seekFromClientX(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentMs - SEEK_KEY_STEP_MS));
    else if (e.key === 'ArrowRight') onSeek(Math.min(durationMs, currentMs + SEEK_KEY_STEP_MS));
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={currentMs}
      className="audio-pill-seek"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <div className="audio-pill-seek-fill" style={{ width: `${percent}%` }} />
      <div className="audio-pill-seek-thumb" style={{ left: `${percent}%` }} />
    </div>
  );
}

// The Downloads page's in-browser audio player — the reader's PlaybackPill
// in an "audio file" variant (see AudioPillMenu's own doc comment): a plain
// <audio> element and a time cursor instead of PlaybackController's word
// cursor. Shares PlayButton/cycleSpeed with the reader pill (pillPrimitives)
// but is otherwise a separate component, not a prop-driven variant — the
// two data models are different enough that forcing one component to serve
// both would add indirection for exactly two call sites (see the task plan).
export function AudioPill({ item, onClose, onPersisted }: AudioPillProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  // Keyed on item.id, not item.audioBlob: DownloadsScreen re-fetches items
  // from IndexedDB every ~5s while this is playing (onPersisted → refresh),
  // which deserializes a brand-new Blob object each time even though the
  // bytes are unchanged — keying on the object reference would tear down
  // and recreate the object URL (interrupting playback) on every refresh.
  const objectUrl = useMemo(() => URL.createObjectURL(item.audioBlob), [item.id]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(item.positionMs);
  const [durationMs, setDurationMs] = useState(item.durationMs);
  const [rate, setRate] = useState(item.rate);
  const [subtitlesOn, setSubtitlesOn] = useState(item.subtitlesOn);
  const [subtitleFilename, setSubtitleFilename] = useState(item.subtitleFilename);
  const [subtitleText, setSubtitleText] = useState(item.subtitleText);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sleepTimer, setSleepTimer] = useState<SleepTimer>(null);
  const { settings: chapterDetection } = useChapterDetection();

  const bookPosition = useApproxBookPosition(item.documentId, currentTimeMs, durationMs, chapterDetection);

  const cues = useMemo<SubtitleCue[]>(
    () => (subtitleText && subtitleFilename ? parseSubtitleFile(subtitleFilename, subtitleText) : []),
    [subtitleText, subtitleFilename],
  );
  const activeCue = subtitlesOn ? cues.find((cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs) ?? null : null;

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  // Resume at the saved position/rate once the file's metadata (and thus a
  // real `duration`) is available.
  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = item.positionMs / 1000;
    audio.playbackRate = item.rate;
    setDurationMs(Math.round(audio.duration * 1000));
  }

  async function persist(positionMs: number) {
    const repo = await getAudioLibraryRepository();
    await repo.updateAudioItemPosition(item.id, positionMs);
    onPersisted();
  }

  // Periodic position save while playing (brief: "every ~5s, on pause, and
  // on pagehide"); the other two triggers are handled by handlePause and the
  // pagehide/unmount effect below.
  useEffect(() => {
    if (!isPlaying) return;
    const handle = window.setInterval(() => {
      if (audioRef.current) void persist(Math.round(audioRef.current.currentTime * 1000));
    }, PERSIST_INTERVAL_MS);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, item.id]);

  useEffect(() => {
    const handlePageHide = () => {
      if (audioRef.current) void persist(Math.round(audioRef.current.currentTime * 1000));
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      handlePageHide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function skip(deltaSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || durationMs / 1000, audio.currentTime + deltaSeconds));
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title });
    navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-SKIP_SECONDS));
    navigator.mediaSession.setActionHandler('seekforward', () => skip(SKIP_SECONDS));
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.title]);

  // Fixed-duration sleep timer — same "pause once the deadline passes"
  // mechanism as ReaderScreen's own sleep timer.
  useEffect(() => {
    if (!sleepTimer || sleepTimer.type !== 'minutes') return;
    const msRemaining = sleepTimer.firesAt - Date.now();
    const handle = window.setTimeout(() => {
      audioRef.current?.pause();
      setSleepTimer(null);
    }, Math.max(0, msRemaining));
    return () => window.clearTimeout(handle);
  }, [sleepTimer]);

  function handlePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else void audio.play();
  }

  function handleRateChange(next: number) {
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    void getAudioLibraryRepository().then((repo) => repo.updateAudioItemSettings(item.id, { rate: next }));
  }

  function handleSeek(nextMs: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = nextMs / 1000;
    setCurrentTimeMs(nextMs);
  }

  async function handleToggleSubtitles() {
    const next = !subtitlesOn;
    setSubtitlesOn(next);
    const repo = await getAudioLibraryRepository();
    await repo.updateAudioItemSettings(item.id, { subtitlesOn: next });
  }

  async function handleImportSubtitlesFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (subtitleInputRef.current) subtitleInputRef.current.value = '';
    if (!file) return;
    const text = await file.text();
    setSubtitleFilename(file.name);
    setSubtitleText(text);
    setSubtitlesOn(true);
    const repo = await getAudioLibraryRepository();
    await repo.updateAudioItemSettings(item.id, { subtitleFilename: file.name, subtitleText: text, subtitlesOn: true });
  }

  function handleSetSleepTimer(choice: AudioSleepTimerChoice) {
    if (choice === 'off') {
      setSleepTimer(null);
    } else if (choice === 'end-of-track') {
      setSleepTimer({ type: 'end-of-track' });
    } else {
      setSleepTimer({ type: 'minutes', label: `${choice} min`, firesAt: Date.now() + choice * 60_000 });
    }
  }

  const sleepTimerLabel = !sleepTimer
    ? 'Off'
    : sleepTimer.type === 'end-of-track'
      ? `End of track · ${formatDuration(Math.max(0, (durationMs - currentTimeMs) / 1000))} left`
      : sleepTimer.label;

  const positionLine = [
    bookPosition
      ? `Ch. ${bookPosition.chapterNumber}${bookPosition.totalPages > 1 ? ` · p. ${bookPosition.pageIndex + 1}` : ''}`
      : null,
    `${formatDuration(currentTimeMs / 1000)} / ${formatDuration(durationMs / 1000)}`,
    'resumes here next time',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="pill-anchor audio-pill-anchor">
      {activeCue && <div className="audio-pill-subtitle">{activeCue.text}</div>}

      {menuOpen && (
        <div className="pill-menu-anchor">
          <AudioPillMenu
            onClose={() => setMenuOpen(false)}
            rate={rate}
            onRateChange={handleRateChange}
            subtitlesOn={subtitlesOn}
            subtitleFilename={subtitleFilename}
            onToggleSubtitles={handleToggleSubtitles}
            onImportSubtitles={() => subtitleInputRef.current?.click()}
            sleepTimerLabel={sleepTimerLabel}
            onSetSleepTimer={handleSetSleepTimer}
          />
        </div>
      )}

      <div className="audio-pill">
        <audio
          ref={audioRef}
          src={objectUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={(e) => setCurrentTimeMs(Math.round(e.currentTarget.currentTime * 1000))}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            void persist(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
          }}
          onEnded={() => setIsPlaying(false)}
          className="visually-hidden"
        />
        <input
          ref={subtitleInputRef}
          type="file"
          accept=".srt,.vtt"
          onChange={handleImportSubtitlesFile}
          className="visually-hidden"
          aria-label="Import subtitle file"
        />

        <div className="audio-pill-row">
          <button type="button" className="pill-icon-btn audio-pill-skip" onClick={() => skip(-SKIP_SECONDS)} aria-label="Back 15 seconds">
            <RewindIcon width={20} height={20} />
            <span className="audio-pill-skip-badge">15</span>
          </button>
          <PlayButton playing={isPlaying} progress={durationMs > 0 ? currentTimeMs / durationMs : 0} size={48} onClick={handlePlayPause} />
          <button type="button" className="pill-icon-btn audio-pill-skip" onClick={() => skip(SKIP_SECONDS)} aria-label="Forward 15 seconds">
            <ForwardIcon width={20} height={20} />
            <span className="audio-pill-skip-badge">15</span>
          </button>

          <div className="pill-divider" />

          <div className="pill-info">
            <div className="pill-info-line1">{item.title}</div>
            <div className="pill-info-line2">{positionLine}</div>
          </div>

          <button
            type="button"
            className="pill-speed-chip"
            onClick={() => handleRateChange(cycleSpeed(rate))}
            aria-label={`Playback speed ${rate}×`}
          >
            {rate}×
          </button>

          <button
            type="button"
            className="pill-icon-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Playback options"
            aria-expanded={menuOpen}
          >
            <MoreHorizontalIcon width={18} height={18} />
          </button>

          <button type="button" className="pill-icon-btn" onClick={onClose} aria-label="Stop and close player">
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <SeekBar currentMs={currentTimeMs} durationMs={durationMs} onSeek={handleSeek} />
      </div>
    </div>
  );
}
