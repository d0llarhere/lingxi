import {
  detectChapters,
  findPageIndexAtOffset,
  findWordIndexAtOrAfterOffset,
  PlaybackController,
  type ChapterRef,
  type LingxiDocument,
  type PlaybackSettings,
  type PlaybackState,
  type ReadingCursor,
  type VoiceInfo,
} from '@lingxi/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { collectCachedSegments } from '../export/collectCachedSegments';
import { exportAudio } from '../export/exportAudio';
import { exportSrt } from '../export/exportSrt';
import { triggerDownload } from '../export/triggerDownload';
import { DownloadRangeDialog } from '../library/DownloadRangeDialog';
import { useLibrary } from '../library/LibraryProvider';
import { RenameDialog } from '../library/RenameDialog';
import { useChapterDetection } from '../settings/useChapterDetection';
import { filterVoicesByOnlinePolicy, PARAGRAPH_PAUSE_MS, useListeningDefaults } from '../settings/useListeningDefaults';
import { useReadingSettings } from '../settings/useReadingSettings';
import { ariaWakeTracker, EDGE_VOICE_PREFIX } from '../tts/edge/EdgeTTSEngine';
import { offlineDownloader } from '../tts/offlineDownload';
import { previewVoice } from '../tts/previewVoice';
import { kokoroEngine, ttsEngine } from '../tts/ttsEngineInstance';
import { ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 } from './formatDuration';
import { PlaybackPill } from './PlaybackPill';
import type { SleepTimerChoice } from './PlaybackMenu';
import { ReaderHeader } from './ReaderHeader';
import { SearchBar } from './SearchBar';
import { TocSidebar, type TocEntry } from './TocSidebar';
import { useReaderShortcuts } from './useReaderShortcuts';
import { WordText, type WordTextHandle } from './WordText';

interface ReaderScreenProps {
  documentId: string;
  // Set when opened via the library list's "resume listening" play button
  // (lingxi-redesign/REDESIGN_BRIEF.md) — starts playback immediately
  // instead of just opening to the current position.
  autoplay?: boolean;
  onBack: () => void;
}

interface LoadedDocument {
  doc: LingxiDocument;
  text: string;
  cursor: ReadingCursor;
  settings: PlaybackSettings;
}

interface CurrentChapter {
  number: number;
  title: string;
  charStart: number;
  nextCharStart: number;
}

// Shared by both the playback-position chapter (ring/sleep-timer) and the
// display-position chapter (header/pill text) below — same lookup, two
// different char offsets.
function findChapterAt(chapters: ChapterRef[], charOffset: number, totalChars: number): CurrentChapter | null {
  if (chapters.length === 0) return null;
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.charStart <= charOffset) index = i;
    else break;
  }
  if (index === -1) return null;
  return {
    number: index + 1,
    title: chapters[index]!.title,
    charStart: chapters[index]!.charStart,
    nextCharStart: chapters[index + 1]?.charStart ?? totalChars,
  };
}

export function ReaderScreen({ documentId, autoplay, onBack }: ReaderScreenProps) {
  const { repository, ready } = useLibrary();
  const { settings: chapterDetection } = useChapterDetection();
  const { settings: readingSettings } = useReadingSettings();
  const { defaults: listeningDefaults } = useListeningDefaults();
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  // Word highlighting during playback is intentionally NOT React state (see
  // WordText.tsx) — it updates via this imperative ref instead, so the
  // highest-frequency event in the app never triggers a re-render of the
  // (potentially huge) word list.
  const wordTextRef = useRef<WordTextHandle>(null);
  // Stable across renders (controllerRef itself never changes identity) so
  // WordText's memo() can actually skip re-rendering when unrelated state
  // (e.g. the rename/delete dialogs) changes elsewhere in this component.
  const handleWordClick = useCallback((wordIndex: number) => {
    controllerRef.current?.seekToWord(wordIndex);
  }, []);

  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [approximateHighlighting, setApproximateHighlighting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [currentCharOffset, setCurrentCharOffset] = useState(0);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  // The paragraph nearest the top of the viewport, reported by WordText as
  // the user scrolls — null until the first IntersectionObserver callback
  // fires. Used (only while not playing) so the header/pill show what's
  // actually on screen instead of a frozen playback position.
  const [visibleParagraphIndex, setVisibleParagraphIndex] = useState<number | null>(null);
  const handleVisibleParagraphChange = useCallback((paragraphIndex: number) => {
    setVisibleParagraphIndex(paragraphIndex);
  }, []);
  const [pillMenuOpen, setPillMenuOpen] = useState(false);
  // Reading-session only, not persisted (brief: resets on document switch) —
  // either a fixed duration from the moment it's set, or "pause once the
  // chapter active when it was set is no longer the current one".
  const [sleepTimer, setSleepTimer] = useState<
    { type: 'minutes'; label: string; firesAt: number } | { type: 'end-of-chapter'; label: string; chapterNumberAtSet: number } | null
  >(null);
  const [kokoroStatus, setKokoroStatus] = useState(kokoroEngine.getStatusSnapshot());
  const [offlineDownloadStatus, setOfflineDownloadStatus] = useState(offlineDownloader.getJobSnapshot(documentId));
  const [ariaWakeStatus, setAriaWakeStatus] = useState(ariaWakeTracker.getStatus());

  // The Kokoro model/download state is app-global (one Worker, one model),
  // not per-document, so this subscribes once for the component's lifetime
  // rather than being re-derived alongside the document-loading effect below.
  useEffect(() => kokoroEngine.subscribe(setKokoroStatus), []);

  // Same reasoning: a single app-global request-in-flight signal, not
  // per-document state.
  useEffect(() => ariaWakeTracker.subscribe(setAriaWakeStatus), []);

  const handleDownloadKokoro = useCallback(() => kokoroEngine.download(), []);

  // offlineDownloader's status is now tracked per documentId (a queue, not
  // a single global in-flight download), so no manual reset is needed on a
  // document switch — just re-subscribe to this document's own status.
  useEffect(() => {
    return offlineDownloader.subscribe(documentId, setOfflineDownloadStatus);
  }, [documentId]);

  // Shared by the old controls' speed row, the pill's speed chip/stepper,
  // and the [ / ] keyboard shortcuts — previously duplicated inline in two
  // places.
  const handleRateChange = useCallback((value: number) => {
    setRate(value);
    controllerRef.current?.setSpeed(value);
  }, []);

  // Listening settings' "Skip buttons jump by" — governs both the pill's
  // prev/next buttons and the ←/→ shortcuts (useReaderShortcuts already
  // just takes callbacks, no change needed there).
  const skipSeconds = useCallback(
    (deltaSeconds: number) => {
      if (!loaded) return;
      const controller = controllerRef.current;
      if (!controller) return;
      const targetOffset = Math.max(0, controller.getCursor().charOffset + deltaSeconds * ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 * rate);
      const wordIndex = findWordIndexAtOrAfterOffset(loaded.doc.structure.words, targetOffset);
      if (wordIndex !== null) controller.seekToWord(wordIndex);
    },
    [loaded, rate],
  );

  const handlePrevious = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (listeningDefaults.skipBy === 'sentence') controller.previousSentence();
    else if (listeningDefaults.skipBy === '15s') skipSeconds(-15);
    else controller.previousParagraph();
  }, [listeningDefaults.skipBy, skipSeconds]);

  const handleNext = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (listeningDefaults.skipBy === 'sentence') controller.nextSentence();
    else if (listeningDefaults.skipBy === '15s') skipSeconds(15);
    else controller.nextParagraph();
  }, [listeningDefaults.skipBy, skipSeconds]);


  // Raw chapter detection, memoized once (detectChapters scans the whole
  // document text) and shared by the TOC fallback and the pill player's
  // "current chapter" derivation below — one scan, two consumers. Defined
  // early (ahead of handleSetSleepTimer, which closes over currentChapter)
  // rather than down near tocEntries, which only needs `chapters` itself.
  const chapters = useMemo<ChapterRef[]>(
    () => (loaded ? detectChapters(loaded.text, chapterDetection) : []),
    [loaded, chapterDetection],
  );

  const totalChars = loaded?.doc.structure.pages.at(-1)?.charEnd ?? 0;

  // The chapter containing the *playback* cursor — stays tied to real
  // reading progress regardless of where the user has scrolled to, since
  // the ring progress and the "end of chapter" sleep timer are both
  // meaningless outside of what's actually playing. null when
  // detectChapters found nothing (pill falls back to a paragraph count).
  const currentChapter = useMemo(
    () => findChapterAt(chapters, currentCharOffset, totalChars),
    [chapters, currentCharOffset, totalChars],
  );

  // What the header/pill *text* should show: the playback chapter while
  // actually playing, or the chapter containing whatever paragraph is
  // currently at the top of the viewport otherwise (paused, idle, or the
  // user scrolled away mid-playback preview) — see WordText's
  // onVisibleParagraphChange and the bug it fixes (header/pill frozen on a
  // stale persisted-cursor position while the page visibly shows chapter
  // 1). Falls back to currentChapter whenever there's no visible-paragraph
  // reading yet (e.g. the very first render, before the observer's first
  // callback).
  const isPlaying = playbackState === 'playing';
  const visibleCharOffset =
    visibleParagraphIndex !== null ? (loaded?.doc.structure.paragraphs[visibleParagraphIndex]?.charStart ?? null) : null;
  const displayCharOffset = isPlaying || visibleCharOffset === null ? currentCharOffset : visibleCharOffset;
  const displayChapter = useMemo(
    () => findChapterAt(chapters, displayCharOffset, totalChars),
    [chapters, displayCharOffset, totalChars],
  );
  const displayPageIndex = loaded ? findPageIndexAtOffset(loaded.doc.structure.pages, displayCharOffset) : 0;

  const handleSetSleepTimer = useCallback(
    (choice: SleepTimerChoice) => {
      if (choice === 'off') {
        setSleepTimer(null);
        return;
      }
      if (choice === 'end-of-chapter') {
        if (!currentChapter) return; // no chapters detected — option shouldn't be reachable, but guard anyway
        setSleepTimer({ type: 'end-of-chapter', label: 'End of chapter', chapterNumberAtSet: currentChapter.number });
        return;
      }
      setSleepTimer({ type: 'minutes', label: `${choice} min`, firesAt: Date.now() + choice * 60_000 });
    },
    [currentChapter],
  );

  // Fixed-duration sleep timer: pauses once the deadline passes. Re-armed
  // whenever sleepTimer changes (a new choice, or cleared via "Off").
  useEffect(() => {
    if (!sleepTimer || sleepTimer.type !== 'minutes') return;
    const msRemaining = sleepTimer.firesAt - Date.now();
    const handle = window.setTimeout(() => {
      controllerRef.current?.pause();
      setSleepTimer(null);
    }, Math.max(0, msRemaining));
    return () => window.clearTimeout(handle);
  }, [sleepTimer]);

  // "End of chapter" sleep timer: pauses the instant the cursor crosses into
  // a chapter other than the one active when the timer was set — checked
  // whenever the derived current chapter changes (i.e. on every confirmed
  // word-boundary cursor update), not on a poll/interval.
  useEffect(() => {
    if (!sleepTimer || sleepTimer.type !== 'end-of-chapter') return;
    if (currentChapter && currentChapter.number !== sleepTimer.chapterNumberAtSet) {
      controllerRef.current?.pause();
      setSleepTimer(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.number]);

  // Whether every sentence (at the current voice+rate) is already cached,
  // and whether all of it is Aria specifically (gates SRT, which needs real
  // word timing — see exportSrt.ts). Recomputed whenever that could have
  // changed: document/voice/rate switch, an offline-download run finishing,
  // or playbackState changing (covers naturally finishing a read-through —
  // every engine writes to the cache as it plays, so reading a document
  // once with one voice can alone make it fully cached with no explicit
  // "download for offline" step).
  const [cacheStatus, setCacheStatus] = useState<{ fullyCached: boolean; allAria: boolean } | null>(null);

  useEffect(() => {
    if (!loaded || !voiceURI) {
      setCacheStatus(null);
      return;
    }
    let cancelled = false;
    collectCachedSegments(loaded.doc, loaded.text, voiceURI, rate).then((records) => {
      if (cancelled) return;
      setCacheStatus(
        records
          ? { fullyCached: true, allAria: records.every((r) => r.engine === 'edge') }
          : { fullyCached: false, allAria: false },
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, voiceURI, rate, offlineDownloadStatus?.status, playbackState]);

  const handleExportAudio = useCallback(async () => {
    if (!loaded || !voiceURI) return;
    const result = await exportAudio(loaded.doc, loaded.text, voiceURI, rate);
    if (result) triggerDownload(result.blob, result.filename);
  }, [loaded, voiceURI, rate]);

  const handleExportSrt = useCallback(async () => {
    if (!loaded || !voiceURI) return;
    const result = await exportSrt(loaded.doc, loaded.text, voiceURI, rate);
    if (result) triggerDownload(result.blob, result.filename);
  }, [loaded, voiceURI, rate]);

  const handlePreviewVoice = useCallback((previewVoiceURI: string) => {
    // Pausing real playback first (same path the Pause button uses) keeps
    // PlaybackController's own state consistent; a raw engine.speak() call
    // would otherwise silently hijack the actual reading audio without the
    // controller ever finding out, leaving it stuck believing it's still
    // 'playing' once the preview ends.
    if (controllerRef.current?.getState() === 'playing') controllerRef.current.pause();
    previewVoice(previewVoiceURI);
  }, []);

  // Load the document, its text, the persisted reading cursor, and playback
  // settings (voice/speed) together, before anything playback-related is
  // constructed.
  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    setLoaded(null);

    (async () => {
      const [fetchedDoc, fetchedText, fetchedCursor, fetchedSettings] = await Promise.all([
        repository.getDocument(documentId),
        repository.getDocumentText(documentId),
        repository.getCursor(documentId),
        repository.getPlaybackSettings(documentId),
      ]);
      await repository.touchLastOpened(documentId);
      if (cancelled || !fetchedDoc || !fetchedCursor) return;
      setLoaded({ doc: fetchedDoc, text: fetchedText ?? '', cursor: fetchedCursor, settings: fetchedSettings });
    })();

    return () => {
      cancelled = true;
    };
  }, [repository, documentId]);

  // Construct the PlaybackController once the document is loaded. The
  // logical cursor (not speechSynthesis) is the source of truth throughout —
  // see PlaybackController / ARCHITECTURE.md §6. This wiring is unchanged
  // from Phase 3; only the rendering below it changed in Phase 4.
  useEffect(() => {
    if (!repository || !loaded) return;
    if (loaded.doc.extractionStatus !== 'ok' || loaded.doc.structure.words.length === 0) return;

    const controller = new PlaybackController({
      documentId: loaded.doc.id,
      structure: loaded.doc.structure,
      documentText: loaded.text,
      initialCursor: loaded.cursor,
      initialVoiceURI: loaded.settings.selectedVoiceURI,
      initialRate: loaded.settings.playbackSpeed,
      initialParagraphPauseMs: PARAGRAPH_PAUSE_MS[listeningDefaults.paragraphPause],
      initialSkipArtifacts: listeningDefaults.skipArtifacts,
      ttsEngine,
      persistCursor: (cursor) => repository.saveCursor(cursor),
      persistSettings: (settings) => repository.savePlaybackSettings(loaded.doc.id, settings),
      onStateChange: setPlaybackState,
      onCursorChange: (cursor) => {
        wordTextRef.current?.setActiveWord(cursor.wordIndex);
        wordTextRef.current?.setActiveSentence(cursor.sentenceIndex);
        setCurrentCharOffset(cursor.charOffset);
        setCurrentParagraphIndex(cursor.paragraphIndex);
        setProgress(controller.getProgress());
      },
      onEstimatedWordChange: (wordIndex) => {
        setApproximateHighlighting(true);
        wordTextRef.current?.setActiveWord(wordIndex);
        const word = loaded.doc.structure.words[wordIndex];
        if (word) wordTextRef.current?.setActiveSentence(word.sentenceIndex);
      },
      onPersistError: (error) => console.error('Failed to persist playback state', error),
    });

    controllerRef.current = controller;
    if (autoplay) controller.play();
    setPlaybackState(controller.getState());
    setCurrentCharOffset(controller.getCursor().charOffset);
    setCurrentParagraphIndex(controller.getCursor().paragraphIndex);
    setProgress(controller.getProgress());
    setRate(loaded.settings.playbackSpeed);
    setVoiceURI(loaded.settings.selectedVoiceURI);
    setApproximateHighlighting(false);
    setVoicesLoading(true);

    if (listeningDefaults.sleepTimerDefault !== 'off') {
      if (listeningDefaults.sleepTimerDefault === 'end-of-chapter') {
        // Computed directly from the just-constructed controller's cursor and
        // the already-fresh `chapters`/`totalChars` for this document — not
        // via currentChapter/handleSetSleepTimer, which both lag a render
        // behind inside this same effect (their state hasn't flushed yet).
        const openChapter = findChapterAt(chapters, controller.getCursor().charOffset, totalChars);
        if (openChapter) {
          setSleepTimer({ type: 'end-of-chapter', label: 'End of chapter', chapterNumberAtSet: openChapter.number });
        }
      } else {
        const minutes = listeningDefaults.sleepTimerDefault;
        setSleepTimer({ type: 'minutes', label: `${minutes} min`, firesAt: Date.now() + minutes * 60_000 });
      }
    }

    controller.getVoices().then((fetchedVoices) => {
      setVoices(filterVoicesByOnlinePolicy(fetchedVoices, listeningDefaults.allowOnlineVoices));
      setVoicesLoading(false);
      // Graceful fallback: a previously-selected voice can vanish (voice
      // pack removed, browser/OS update, moved to a machine without it).
      // Silently keeping the stale voiceURI would mean the browser falls
      // back to *some* default anyway, but the UI would show it as unset
      // while a phantom selection stays persisted. Detect and reset instead.
      const selected = loaded.settings.selectedVoiceURI;
      if (selected && !fetchedVoices.some((v) => v.voiceURI === selected)) {
        controller.setVoice(null);
        setVoiceURI(null);
      }
    });

    // Persist and stop cleanly if the tab is backgrounded or closed, rather
    // than relying solely on periodic in-play persistence.
    const handleVisibility = () => {
      if (document.hidden) controller.pause();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleVisibility);
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, loaded?.doc.id]);

  // Chapters first; if none were detected (no recognizable headers — true
  // for most pasted text, and for PDFs without a clear "Chapter N" style),
  // fall back to one entry per PDF page so the TOC is never empty for a
  // document that has real page boundaries.
  const tocEntries = useMemo<TocEntry[]>(() => {
    if (!loaded) return [];
    if (chapters.length > 0) return chapters;
    if (loaded.doc.structure.pages.length > 1) {
      return loaded.doc.structure.pages.map((page) => ({
        title: `Page ${page.index + 1}`,
        charStart: page.charStart,
      }));
    }
    return [];
  }, [loaded, chapters]);

  const handleTocSelect = useCallback(
    (charStart: number) => {
      if (!loaded) return;
      const wordIndex = findWordIndexAtOrAfterOffset(loaded.doc.structure.words, charStart);
      if (wordIndex !== null) controllerRef.current?.seekToWord(wordIndex);
      setTocOpen(false);
    },
    [loaded],
  );

  // Plain case-insensitive substring match over the full in-memory text —
  // no index needed, the document is already fully loaded client-side.
  // Memoized so this only re-scans on an actual query/document change, not
  // every render.
  const searchMatchOffsets = useMemo<number[]>(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!loaded || !needle) return [];
    const haystack = loaded.text.toLowerCase();
    const offsets: number[] = [];
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      offsets.push(index);
      index = haystack.indexOf(needle, index + 1);
    }
    return offsets;
  }, [loaded, searchQuery]);

  // Resets to the first match whenever the match set itself changes (typing
  // a new query, or switching documents) — an index into the *previous*
  // query's results would be meaningless against this one.
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchMatchOffsets]);

  // Pushes the full match set to WordText's imperative highlight API (never
  // React state — see WordText.tsx's perf note) whenever it changes.
  useEffect(() => {
    if (!loaded) return;
    const wordIndices = new Set<number>();
    for (const offset of searchMatchOffsets) {
      const wordIndex = findWordIndexAtOrAfterOffset(loaded.doc.structure.words, offset);
      if (wordIndex !== null) wordIndices.add(wordIndex);
    }
    wordTextRef.current?.setSearchMatches(wordIndices);
  }, [loaded, searchMatchOffsets]);

  const seekToMatch = useCallback(
    (matchIndex: number) => {
      if (!loaded) return;
      const offset = searchMatchOffsets[matchIndex];
      if (offset === undefined) return;
      const wordIndex = findWordIndexAtOrAfterOffset(loaded.doc.structure.words, offset);
      if (wordIndex === null) return;
      wordTextRef.current?.setActiveMatch(wordIndex);
      // Also moves playback here — "clicking a hit jumps to that offset the
      // same way" a TOC entry or any clicked word does (seekToWord already
      // cancels, updates+persists the cursor, and starts speaking from there).
      controllerRef.current?.seekToWord(wordIndex);
    },
    [loaded, searchMatchOffsets],
  );

  const handleSearchNext = useCallback(() => {
    if (searchMatchOffsets.length === 0) return;
    const next = (activeMatchIndex + 1) % searchMatchOffsets.length;
    setActiveMatchIndex(next);
    seekToMatch(next);
  }, [searchMatchOffsets.length, activeMatchIndex, seekToMatch]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatchOffsets.length === 0) return;
    const previous = (activeMatchIndex - 1 + searchMatchOffsets.length) % searchMatchOffsets.length;
    setActiveMatchIndex(previous);
    seekToMatch(previous);
  }, [searchMatchOffsets.length, activeMatchIndex, seekToMatch]);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    wordTextRef.current?.setSearchMatches(new Set());
    wordTextRef.current?.setActiveMatch(null);
  }, []);

  // Document switch: WordText's word elements (and their indices) are about
  // to be entirely rebuilt for the new document — a stale match/active-match
  // index from the previous one would be meaningless (or, worse, coincide
  // with an unrelated word in the new document). Close search outright
  // rather than try to carry a query across documents.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setVisibleParagraphIndex(null);
  }, [documentId]);

  useReaderShortcuts({
    onPlayPause: () => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (controller.getState() === 'playing') controller.pause();
      else controller.play();
    },
    // Matches the pill's prev/next buttons (brief: "← → previous/next
    // paragraph") — the old bottom bar's own prev/next buttons are
    // unaffected, still sentence-level, until it's deleted in [pill-cleanup].
    onPrevious: handlePrevious,
    onNext: handleNext,
    onSpeedDown: () => handleRateChange(Math.round((rate - 0.25) * 100) / 100),
    onSpeedUp: () => handleRateChange(Math.round((rate + 0.25) * 100) / 100),
    isMenuOpen: pillMenuOpen,
    onEscape: onBack,
  });

  async function handleRenameSubmit(title: string) {
    if (!repository || !loaded) return;
    await repository.rename(loaded.doc.id, title);
    setLoaded({ ...loaded, doc: { ...loaded.doc, title } });
  }

  async function handleConfirmDelete() {
    if (!repository || !loaded) return;
    await repository.deleteDocument(loaded.doc.id);
    onBack();
  }

  if (!ready || !loaded) {
    return <p className="status-message" style={{ padding: 'var(--space-5)' }}>Loading document…</p>;
  }

  const { doc, text } = loaded;
  const totalPages = doc.structure.pages.length;
  const displayPage = totalPages > 1 ? displayPageIndex + 1 : null;
  const totalParagraphs = doc.structure.paragraphs.length;
  // The ring stays tied to the real playback chapter — it's only ever
  // rendered while playing (see PlaybackPill's PlayButton), by which point
  // displayChapter === currentChapter anyway, so this never needs to switch
  // basis.
  const pillProgress = currentChapter
    ? Math.min(
        1,
        Math.max(0, (currentCharOffset - currentChapter.charStart) / (currentChapter.nextCharStart - currentChapter.charStart || 1)),
      )
    : progress;
  const remainingInChapterSeconds = displayChapter
    ? (displayChapter.nextCharStart - displayCharOffset) / (ESTIMATED_CHARS_PER_SECOND_AT_RATE_1 * rate)
    : null;

  return (
    <ReaderHeader
      title={doc.title}
      chapterSubtitle={displayChapter ? `Chapter ${displayChapter.number} · ${displayChapter.title}` : undefined}
      onBack={onBack}
      onRename={() => setRenaming(true)}
      onDelete={() => setDeleting(true)}
      onToggleToc={() => setTocOpen((open) => !open)}
      onToggleSearch={() => setSearchOpen((open) => !open)}
    >
      <div className="reader-layout">
        {tocOpen && (
          <TocSidebar
            entries={tocEntries}
            activeCharOffset={currentCharOffset}
            onSelect={handleTocSelect}
            onClose={() => setTocOpen(false)}
          />
        )}
        <div className="reader-page">
          {searchOpen && (
            <SearchBar
              query={searchQuery}
              matchCount={searchMatchOffsets.length}
              activeMatchIndex={activeMatchIndex}
              onQueryChange={setSearchQuery}
              onNext={handleSearchNext}
              onPrevious={handleSearchPrevious}
              onClose={handleSearchClose}
            />
          )}
          {doc.extractionStatus === 'no-text' ? (
            <div className="reading-surface">
              <p className="reading-empty-notice" role="alert">
                This PDF appears to contain scanned/image pages. OCR is not enabled yet.
              </p>
            </div>
          ) : doc.structure.words.length === 0 ? (
            <div className="reading-surface">
              <p className="reading-empty-notice">This document has no readable text.</p>
            </div>
          ) : (
            <>
              {voiceURI?.startsWith(EDGE_VOICE_PREFIX) && ariaWakeStatus === 'waking' && (
                <p className="approximate-note">Waking up Aria… the server went idle and takes up to a minute to start.</p>
              )}
              {approximateHighlighting && (
                <p className="approximate-note">Word highlighting is approximate on this browser/voice.</p>
              )}
              <div
                className={`reading-surface${
                  readingSettings.highlightMode === 'off'
                    ? ' reading-highlight-off'
                    : readingSettings.highlightMode === 'sentence'
                      ? ' reading-highlight-sentence'
                      : ''
                }`}
              >
                <WordText
                  ref={wordTextRef}
                  text={text}
                  words={doc.structure.words}
                  paragraphs={doc.structure.paragraphs}
                  initialHighlightWordIndex={loaded.cursor.wordIndex}
                  onWordClick={handleWordClick}
                  onVisibleParagraphChange={handleVisibleParagraphChange}
                  autoScrollEnabled={readingSettings.autoScroll}
                />
              </div>
              <div className="pill-dock">
                <PlaybackPill
                  state={playbackState}
                  progress={pillProgress}
                  rate={rate}
                  chapterNumber={displayChapter?.number ?? null}
                  chapterTitle={displayChapter?.title ?? null}
                  paragraphNumber={(isPlaying || visibleParagraphIndex === null ? currentParagraphIndex : visibleParagraphIndex) + 1}
                  totalParagraphs={totalParagraphs}
                  currentPage={displayPage}
                  totalPages={totalPages}
                  remainingInChapterSeconds={remainingInChapterSeconds}
                  menuOpen={pillMenuOpen}
                  onToggleMenu={() => setPillMenuOpen((open) => !open)}
                  onCloseMenu={() => setPillMenuOpen(false)}
                  onPlay={() => controllerRef.current?.play()}
                  onPause={() => controllerRef.current?.pause()}
                  onPrevious={handlePrevious}
                  onNext={handleNext}
                  onRateChange={handleRateChange}
                  voices={voices}
                  voiceURI={voiceURI}
                  onVoiceChange={(value) => {
                    setVoiceURI(value);
                    controllerRef.current?.setVoice(value);
                  }}
                  onPreviewVoice={handlePreviewVoice}
                  sleepTimerLabel={sleepTimer?.label ?? 'Off'}
                  onSetSleepTimer={handleSetSleepTimer}
                  kokoroStatus={kokoroStatus}
                  onDownloadKokoro={handleDownloadKokoro}
                  offlineDownloadStatus={offlineDownloadStatus}
                  onDownloadOffline={() => {
                    setPillMenuOpen(false);
                    setDownloadDialogOpen(true);
                  }}
                  cacheStatus={cacheStatus}
                  onExportAudio={handleExportAudio}
                  onExportSrt={handleExportSrt}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {renaming && (
        <RenameDialog initialTitle={doc.title} onClose={() => setRenaming(false)} onSubmit={handleRenameSubmit} />
      )}

      {downloadDialogOpen && <DownloadRangeDialog documentId={documentId} onClose={() => setDownloadDialogOpen(false)} />}

      {deleting && (
        <ConfirmDialog
          title="Delete document"
          message={`Delete "${doc.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </ReaderHeader>
  );
}
