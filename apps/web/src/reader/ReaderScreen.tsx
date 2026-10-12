import {
  detectChapters,
  findWordIndexAtOrAfterOffset,
  PlaybackController,
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
import { useLibrary } from '../library/LibraryProvider';
import { RenameDialog } from '../library/RenameDialog';
import { ariaWakeTracker } from '../tts/edge/EdgeTTSEngine';
import { offlineDownloader } from '../tts/offlineDownload';
import { kokoroEngine, ttsEngine } from '../tts/ttsEngineInstance';
import { PlaybackControls } from './PlaybackControls';
import { ReaderHeader } from './ReaderHeader';
import { SearchBar } from './SearchBar';
import { TocSidebar, type TocEntry } from './TocSidebar';
import { useReaderShortcuts } from './useReaderShortcuts';
import { WordText, type WordTextHandle } from './WordText';

interface ReaderScreenProps {
  documentId: string;
  onBack: () => void;
}

interface LoadedDocument {
  doc: LingxiDocument;
  text: string;
  cursor: ReadingCursor;
  settings: PlaybackSettings;
}

export function ReaderScreen({ documentId, onBack }: ReaderScreenProps) {
  const { repository, ready } = useLibrary();
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
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [approximateHighlighting, setApproximateHighlighting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [currentCharOffset, setCurrentCharOffset] = useState(0);
  const [kokoroStatus, setKokoroStatus] = useState(kokoroEngine.getStatusSnapshot());
  const [offlineDownloadStatus, setOfflineDownloadStatus] = useState(offlineDownloader.getStatusSnapshot());
  const [ariaWakeStatus, setAriaWakeStatus] = useState(ariaWakeTracker.getStatus());

  // The Kokoro model/download state is app-global (one Worker, one model),
  // not per-document, so this subscribes once for the component's lifetime
  // rather than being re-derived alongside the document-loading effect below.
  useEffect(() => kokoroEngine.subscribe(setKokoroStatus), []);

  // Same reasoning: a single app-global request-in-flight signal, not
  // per-document state.
  useEffect(() => ariaWakeTracker.subscribe(setAriaWakeStatus), []);

  const handleDownloadKokoro = useCallback(() => kokoroEngine.download(), []);

  // offlineDownloader is a single app-global instance (like kokoroEngine),
  // so its last status can be leftover from a *different* document — reset
  // to not-started on every document switch, then let the subscription
  // reflect reality for this document going forward.
  useEffect(() => {
    setOfflineDownloadStatus({ status: 'not-started', progress: 0, error: null, etaSeconds: null });
    return offlineDownloader.subscribe(setOfflineDownloadStatus);
  }, [documentId]);

  const handleDownloadOffline = useCallback(() => {
    if (!loaded || !voiceURI) return;
    void offlineDownloader.download(loaded.doc, loaded.text, voiceURI, rate);
  }, [loaded, voiceURI, rate]);

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
  }, [loaded, voiceURI, rate, offlineDownloadStatus.status, playbackState]);

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
      ttsEngine,
      persistCursor: (cursor) => repository.saveCursor(cursor),
      persistSettings: (settings) => repository.savePlaybackSettings(loaded.doc.id, settings),
      onStateChange: setPlaybackState,
      onCursorChange: (cursor) => {
        wordTextRef.current?.setActiveWord(cursor.wordIndex);
        setCurrentPageIndex(cursor.pageIndex);
        setCurrentCharOffset(cursor.charOffset);
        setProgress(controller.getProgress());
      },
      onEstimatedWordChange: (wordIndex) => {
        setApproximateHighlighting(true);
        wordTextRef.current?.setActiveWord(wordIndex);
      },
      onPersistError: (error) => console.error('Failed to persist playback state', error),
    });

    controllerRef.current = controller;
    setPlaybackState(controller.getState());
    setCurrentPageIndex(controller.getCursor().pageIndex);
    setCurrentCharOffset(controller.getCursor().charOffset);
    setProgress(controller.getProgress());
    setRate(loaded.settings.playbackSpeed);
    setVoiceURI(loaded.settings.selectedVoiceURI);
    setApproximateHighlighting(false);
    setVoicesLoading(true);

    controller.getVoices().then((fetchedVoices) => {
      setVoices(fetchedVoices);
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
  // document that has real page boundaries. Memoized: detectChapters scans
  // the whole document text, not worth re-running on every render.
  const tocEntries = useMemo<TocEntry[]>(() => {
    if (!loaded) return [];
    const chapters = detectChapters(loaded.text);
    if (chapters.length > 0) return chapters;
    if (loaded.doc.structure.pages.length > 1) {
      return loaded.doc.structure.pages.map((page) => ({
        title: `Page ${page.index + 1}`,
        charStart: page.charStart,
      }));
    }
    return [];
  }, [loaded]);

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
  }, [documentId]);

  useReaderShortcuts({
    onPlayPause: () => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (controller.getState() === 'playing') controller.pause();
      else controller.play();
    },
    onPrevious: () => controllerRef.current?.previousSentence(),
    onNext: () => controllerRef.current?.nextSentence(),
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
  const currentPage = totalPages > 1 ? currentPageIndex + 1 : null;
  const totalChars = doc.structure.pages.at(-1)?.charEnd ?? 0;

  return (
    <ReaderHeader
      title={doc.title}
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
              <div className="reading-surface">
                <WordText
                  ref={wordTextRef}
                  text={text}
                  words={doc.structure.words}
                  paragraphs={doc.structure.paragraphs}
                  initialHighlightWordIndex={loaded.cursor.wordIndex}
                  onWordClick={handleWordClick}
                />
              </div>
              <PlaybackControls
                state={playbackState}
                progress={progress}
                rate={rate}
                voices={voices}
                voicesLoading={voicesLoading}
                voiceURI={voiceURI}
                kokoroStatus={kokoroStatus}
                offlineDownloadStatus={offlineDownloadStatus}
                ariaWakeStatus={ariaWakeStatus}
                cacheStatus={cacheStatus}
                approximateHighlighting={approximateHighlighting}
                currentPage={currentPage}
                totalPages={totalPages}
                currentCharOffset={currentCharOffset}
                totalChars={totalChars}
                onPlay={() => controllerRef.current?.play()}
                onPause={() => controllerRef.current?.pause()}
                onStop={() => controllerRef.current?.stop()}
                onPrevious={() => controllerRef.current?.previousSentence()}
                onNext={() => controllerRef.current?.nextSentence()}
                onRateChange={(value) => {
                  setRate(value);
                  controllerRef.current?.setSpeed(value);
                }}
                onVoiceChange={(value) => {
                  setVoiceURI(value);
                  controllerRef.current?.setVoice(value);
                }}
                onDownloadKokoro={handleDownloadKokoro}
                onDownloadOffline={handleDownloadOffline}
                onExportAudio={handleExportAudio}
                onExportSrt={handleExportSrt}
                onSeek={(fraction) => controllerRef.current?.seekToProgress(fraction)}
              />
            </>
          )}
        </div>
      </div>

      {renaming && (
        <RenameDialog initialTitle={doc.title} onClose={() => setRenaming(false)} onSubmit={handleRenameSubmit} />
      )}

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
