import {
  PlaybackController,
  type LingxiDocument,
  type PlaybackSettings,
  type PlaybackState,
  type ReadingCursor,
  type VoiceInfo,
} from '@lingxi/core';
import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../library/LibraryProvider';
import { ttsEngine } from '../tts/ttsEngineInstance';
import { PlaybackControls } from './PlaybackControls';
import { WordText } from './WordText';

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

  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [highlightWordIndex, setHighlightWordIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [approximateHighlighting, setApproximateHighlighting] = useState(false);

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
  // see PlaybackController / ARCHITECTURE.md §6.
  useEffect(() => {
    if (!repository || !loaded) return;
    if (loaded.doc.extractionStatus !== 'ok' || loaded.doc.structure.words.length === 0) return;

    const controller = new PlaybackController({
      documentId: loaded.doc.id,
      structure: loaded.doc.structure,
      initialCursor: loaded.cursor,
      initialVoiceURI: loaded.settings.selectedVoiceURI,
      initialRate: loaded.settings.playbackSpeed,
      ttsEngine,
      persistCursor: (cursor) => repository.saveCursor(cursor),
      persistSettings: (settings) => repository.savePlaybackSettings(loaded.doc.id, settings),
      onStateChange: setPlaybackState,
      onCursorChange: (cursor) => {
        setHighlightWordIndex(cursor.wordIndex);
        setProgress(controller.getProgress());
      },
      onEstimatedWordChange: (wordIndex) => {
        setApproximateHighlighting(true);
        setHighlightWordIndex(wordIndex);
      },
      onPersistError: (error) => console.error('Failed to persist playback state', error),
    });

    controllerRef.current = controller;
    setPlaybackState(controller.getState());
    setHighlightWordIndex(controller.getCursor().wordIndex);
    setProgress(controller.getProgress());
    setRate(loaded.settings.playbackSpeed);
    setVoiceURI(loaded.settings.selectedVoiceURI);
    setApproximateHighlighting(false);

    controller.getVoices().then(setVoices);

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

  if (!ready || !loaded) {
    return <p>Loading document…</p>;
  }

  const { doc, text } = loaded;

  return (
    <section>
      <button onClick={onBack}>Back to library</button>
      <h1>{doc.title}</h1>

      {doc.extractionStatus === 'no-text' ? (
        <p role="alert">This PDF appears to contain scanned/image pages. OCR is not enabled yet.</p>
      ) : doc.structure.words.length === 0 ? (
        <p>This document has no readable text.</p>
      ) : (
        <>
          <PlaybackControls
            state={playbackState}
            progress={progress}
            rate={rate}
            voices={voices}
            voiceURI={voiceURI}
            approximateHighlighting={approximateHighlighting}
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
            onSeek={(fraction) => controllerRef.current?.seekToProgress(fraction)}
          />
          <WordText
            text={text}
            words={doc.structure.words}
            highlightWordIndex={highlightWordIndex}
            onWordClick={(wordIndex) => controllerRef.current?.seekToWord(wordIndex)}
          />
        </>
      )}
    </section>
  );
}
