import {
  buildChunkSequence,
  chunkCharRanges,
  chunkRangeForCharOffsets,
  detectChapters,
  findPageIndexAtOffset,
  mergeChunkRanges,
  snapCharRangeToParagraphs,
  subtractChunkRanges,
  type AudioItemRecord,
  type ChapterDetectionSettings,
  type ChapterRef,
  type ChunkIndexRange,
  type LingxiDocument,
} from '@lingxi/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, DownloadIcon } from '../components/icons';
import { Modal } from '../components/Modal';
import { SegmentedControl } from '../components/SegmentedControl';
import { useChapterDetection } from '../settings/useChapterDetection';
import { filterVoicesByOnlinePolicy, readListeningDefaults } from '../settings/useListeningDefaults';
import { EDGE_VOICES } from '../tts/edge/EdgeTTSEngine';
import { KOKORO_VOICES } from '../tts/kokoro/KokoroTTSEngine';
import { offlineDownloader } from '../tts/offlineDownload';
import { getAudioLibraryRepository } from './audioLibraryInstance';
import { useLibrary } from './LibraryProvider';
import { formatBytes } from './StorageCard';

const CACHEABLE_VOICES = [...KOKORO_VOICES, ...EDGE_VOICES];
// Rough speech-audio estimate (~16kbps) used only until a book has any real
// downloaded audio to measure from — see the brief's own "or a constant
// until there's data".
const FALLBACK_BYTES_PER_CHAR = 150;

type Mode = 'whole' | 'chapters' | 'pages';

interface DownloadRangeDialogProps {
  documentId: string;
  onClose: () => void;
  // "Download more…" pre-fill (Downloads page, a partially-downloaded
  // book): starts the Chapters range right after the last saved chapter.
  startAfterChapterNumber?: number;
}

export function DownloadRangeDialog({ documentId, onClose, startAfterChapterNumber }: DownloadRangeDialogProps) {
  const { repository } = useLibrary();
  const { settings: chapterDetection } = useChapterDetection();
  const [loaded, setLoaded] = useState<{
    doc: LingxiDocument;
    documentText: string;
    cursorCharOffset: number;
    voiceURI: string;
    rate: number;
  } | null>(null);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    (async () => {
      const [doc, documentText, cursor, settings] = await Promise.all([
        repository.getDocument(documentId),
        repository.getDocumentText(documentId),
        repository.getCursor(documentId),
        repository.getPlaybackSettings(documentId),
      ]);
      if (cancelled || !doc || documentText === undefined) return;
      const voiceURI = settings.selectedVoiceURI ?? readListeningDefaults().defaultVoiceURI ?? CACHEABLE_VOICES[0]!.voiceURI;
      setLoaded({ doc, documentText, cursorCharOffset: cursor?.charOffset ?? 0, voiceURI, rate: settings.playbackSpeed });
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, documentId]);

  if (!loaded) {
    return (
      <Modal title="Download for offline" onClose={onClose} wide>
        <p className="status-message">Loading…</p>
      </Modal>
    );
  }

  return (
    <DownloadRangeDialogLoaded
      {...loaded}
      chapterDetection={chapterDetection}
      startAfterChapterNumber={startAfterChapterNumber}
      onClose={onClose}
    />
  );
}

function chapterIndexAt(chapters: ChapterRef[], charOffset: number): number {
  let index = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.charStart <= charOffset) index = i;
    else break;
  }
  return index;
}

function chapterCharRange(chapters: ChapterRef[], fromNumber: number, toNumber: number, totalChars: number): { charStart: number; charEnd: number } {
  const fromIdx = Math.max(0, Math.min(fromNumber, toNumber) - 1);
  const toIdx = Math.max(0, Math.max(fromNumber, toNumber) - 1);
  return { charStart: chapters[fromIdx]!.charStart, charEnd: chapters[toIdx + 1]?.charStart ?? totalChars };
}

function DownloadRangeDialogLoaded({
  doc,
  documentText,
  cursorCharOffset,
  voiceURI: initialVoiceURI,
  rate,
  chapterDetection,
  startAfterChapterNumber,
  onClose,
}: {
  doc: LingxiDocument;
  documentText: string;
  cursorCharOffset: number;
  voiceURI: string;
  rate: number;
  chapterDetection: ChapterDetectionSettings;
  startAfterChapterNumber?: number;
  onClose: () => void;
}) {
  const chapters = useMemo(() => detectChapters(documentText, chapterDetection), [documentText, chapterDetection]);
  const hasChapters = chapters.length > 0;
  const totalChars = documentText.length;
  const pages = doc.structure.pages;
  const totalPages = pages.length;
  const chunks = useMemo(() => buildChunkSequence(doc.structure, documentText), [doc.structure, documentText]);
  const charRanges = useMemo(() => chunkCharRanges(chunks, doc.structure), [chunks, doc.structure]);

  const [mode, setMode] = useState<Mode>(hasChapters ? 'chapters' : 'pages');
  const [voiceURI, setVoiceURI] = useState(initialVoiceURI);
  const [existing, setExisting] = useState<AudioItemRecord | null>(null);
  const [enqueuing, setEnqueuing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAudioLibraryRepository().then(async (repo) => {
      const record = await repo.getAudioItem(`book-${doc.id}-${voiceURI}-${rate}`);
      if (!cancelled) setExisting(record ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.id, voiceURI, rate]);

  const currentChapterNumber = hasChapters ? chapterIndexAt(chapters, cursorCharOffset) + 1 : 1;
  const currentPageNumber = findPageIndexAtOffset(pages, cursorCharOffset) + 1;

  const [fromChapter, setFromChapterState] = useState(() =>
    startAfterChapterNumber ? Math.min(startAfterChapterNumber + 1, Math.max(1, chapters.length)) : currentChapterNumber,
  );
  const [toChapter, setToChapterState] = useState(chapters.length || 1);
  const [fromPage, setFromPageState] = useState(currentPageNumber);
  const [toPage, setToPageState] = useState(totalPages || 1);

  function setFromChapter(n: number) {
    const clamped = Math.max(1, Math.min(n, chapters.length || 1));
    setFromChapterState(clamped);
    setToChapterState((to) => Math.max(to, clamped));
  }
  function setToChapter(n: number) {
    const clamped = Math.max(1, Math.min(n, chapters.length || 1));
    setToChapterState(clamped);
    setFromChapterState((from) => Math.min(from, clamped));
  }
  function setFromPage(n: number) {
    const clamped = Math.max(1, Math.min(n, totalPages || 1));
    setFromPageState(clamped);
    setToPageState((to) => Math.max(to, clamped));
  }
  function setToPage(n: number) {
    const clamped = Math.max(1, Math.min(n, totalPages || 1));
    setToPageState(clamped);
    setFromPageState((from) => Math.min(from, clamped));
  }

  const charRange: { charStart: number; charEnd: number } | null =
    mode === 'whole'
      ? { charStart: 0, charEnd: totalChars }
      : mode === 'chapters'
        ? hasChapters
          ? chapterCharRange(chapters, fromChapter, toChapter, totalChars)
          : null
        : snapCharRangeToParagraphs(
            doc.structure.paragraphs,
            pages[Math.min(fromPage, toPage) - 1]?.charStart ?? 0,
            pages[Math.max(fromPage, toPage) - 1]?.charEnd ?? totalChars,
          );

  const selectedChunkRange: ChunkIndexRange | null = charRange ? chunkRangeForCharOffsets(charRanges, charRange.charStart, charRange.charEnd) : null;
  const existingRanges = useMemo(() => mergeChunkRanges(existing?.chunkRanges ?? []), [existing]);
  const missingRanges = selectedChunkRange ? subtractChunkRanges(selectedChunkRange, existingRanges) : [];
  const alreadyFullyCovered = selectedChunkRange !== null && missingRanges.length === 0;

  function fractionOfBook(range: ChunkIndexRange): number {
    if (totalChars <= 0) return 0;
    const from = charRanges[range.fromChunkIndex]?.charStart ?? 0;
    const to = charRanges[range.toChunkIndex]?.charEnd ?? 0;
    return (to - from) / totalChars;
  }
  const alreadySavedFraction = existingRanges.reduce((sum, r) => sum + fractionOfBook(r), 0);
  const newFraction = missingRanges.reduce((sum, r) => sum + fractionOfBook(r), 0);
  const restFraction = Math.max(0, 1 - alreadySavedFraction - newFraction);

  function unitLabel(charStart: number, charEnd: number): string {
    if (hasChapters) {
      const from = chapterIndexAt(chapters, charStart) + 1;
      const to = chapterIndexAt(chapters, Math.max(charStart, charEnd - 1)) + 1;
      return from === to ? `Ch. ${from}` : `Ch. ${from}–${to}`;
    }
    const from = findPageIndexAtOffset(pages, charStart) + 1;
    const to = findPageIndexAtOffset(pages, Math.max(charStart, charEnd - 1)) + 1;
    return from === to ? `p. ${from}` : `p. ${from}–${to}`;
  }
  const savedCharSpan = existingRanges.length > 0 ? spanOf(existingRanges, charRanges) : null;
  // Clipped to the user's logical selection (charRange), not the raw
  // chunk-rounded missingRanges — storage is chunk-granular (~900 chars),
  // so an unclipped span can spill a few hundred characters past the
  // chapter/page the user actually picked (e.g. into the tail of the
  // previous chapter when it doesn't end on a chunk boundary), which read
  // as an off-by-one chapter in the legend even though the stats line
  // (computed straight from charRange) was already correct.
  const rawNewCharSpan = missingRanges.length > 0 ? spanOf(missingRanges, charRanges) : null;
  const newCharSpan =
    rawNewCharSpan && charRange
      ? { charStart: Math.max(rawNewCharSpan.charStart, charRange.charStart), charEnd: Math.min(rawNewCharSpan.charEnd, charRange.charEnd) }
      : null;

  const coveredChars = existingRanges.reduce((sum, r) => sum + Math.max(0, (charRanges[r.toChunkIndex]?.charEnd ?? 0) - (charRanges[r.fromChunkIndex]?.charStart ?? 0)), 0);
  const bytesPerChar = existing && coveredChars > 0 ? existing.sizeBytes / coveredChars : FALLBACK_BYTES_PER_CHAR;
  const estimatedBytes = charRange ? (charRange.charEnd - charRange.charStart) * bytesPerChar : 0;

  const selectedChapterCount = charRange ? chapterIndexAt(chapters, Math.max(charRange.charStart, charRange.charEnd - 1)) - chapterIndexAt(chapters, charRange.charStart) + 1 : 0;
  const selectedPageCount = charRange
    ? findPageIndexAtOffset(pages, Math.max(charRange.charStart, charRange.charEnd - 1)) - findPageIndexAtOffset(pages, charRange.charStart) + 1
    : 0;
  const selectedPageSpan = charRange ? `p. ${findPageIndexAtOffset(pages, charRange.charStart) + 1}–${findPageIndexAtOffset(pages, Math.max(charRange.charStart, charRange.charEnd - 1)) + 1}` : '';
  const selectedChapterSpan = charRange && hasChapters
    ? `Ch. ${chapterIndexAt(chapters, charRange.charStart) + 1}–${chapterIndexAt(chapters, Math.max(charRange.charStart, charRange.charEnd - 1)) + 1}`
    : '';

  const summaryStats =
    mode === 'pages'
      ? [`${selectedPageCount} page${selectedPageCount === 1 ? '' : 's'}`, hasChapters ? selectedChapterSpan : null, `about ${formatBytes(estimatedBytes)}`]
      : [`${selectedChapterCount || selectedPageCount} ${hasChapters ? 'chapter' : 'page'}${(selectedChapterCount || selectedPageCount) === 1 ? '' : 's'}`, selectedPageSpan, `about ${formatBytes(estimatedBytes)}`];

  const downloadLabel =
    mode === 'whole' ? 'Download whole book' : mode === 'chapters' ? `Download ${selectedChapterCount} chapter${selectedChapterCount === 1 ? '' : 's'}` : `Download ${selectedPageCount} page${selectedPageCount === 1 ? '' : 's'}`;

  const selectedVoice = CACHEABLE_VOICES.find((v) => v.voiceURI === voiceURI);
  const allowOnlineVoices = readListeningDefaults().allowOnlineVoices;
  const availableVoices = filterVoicesByOnlinePolicy(CACHEABLE_VOICES, allowOnlineVoices);

  async function handleDownload() {
    if (!selectedChunkRange || alreadyFullyCovered) return;
    setEnqueuing(true);
    await offlineDownloader.enqueue(doc, voiceURI, rate, selectedChunkRange);
    onClose();
  }

  function applyChapterChip(kind: 'this' | 'next10' | 'next25' | 'rest') {
    const total = chapters.length || 1;
    if (kind === 'this') {
      setFromChapterState(currentChapterNumber);
      setToChapterState(currentChapterNumber);
    } else if (kind === 'next10') {
      setFromChapterState(currentChapterNumber);
      setToChapterState(Math.min(currentChapterNumber + 9, total));
    } else if (kind === 'next25') {
      setFromChapterState(currentChapterNumber);
      setToChapterState(Math.min(currentChapterNumber + 24, total));
    } else {
      setFromChapterState(currentChapterNumber);
      setToChapterState(total);
    }
  }

  function applyPageChip(kind: 'current' | 'next50' | 'next100' | 'end') {
    const total = totalPages || 1;
    if (kind === 'current') {
      setFromPageState(currentPageNumber);
      setToPageState((to) => Math.max(to, currentPageNumber));
    } else if (kind === 'next50') {
      setFromPageState(currentPageNumber);
      setToPageState(Math.min(currentPageNumber + 49, total));
    } else if (kind === 'next100') {
      setFromPageState(currentPageNumber);
      setToPageState(Math.min(currentPageNumber + 99, total));
    } else {
      setFromPageState(currentPageNumber);
      setToPageState(total);
    }
  }

  const subtitle = doc.title + (totalPages > 1 ? ` · ${totalPages} pages` : '');

  return (
    <Modal title="Download for offline" subtitle={subtitle} onClose={onClose} wide>
      <div className="download-dialog-body">
        <SegmentedControl<Mode>
          ariaLabel="What to download"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'whole', label: 'Whole book' },
            {
              value: 'chapters',
              label: 'Chapters',
              disabled: !hasChapters,
              title: hasChapters ? undefined : 'No chapters detected for this book — turn Chapters on in Settings, or use Pages instead.',
            },
            { value: 'pages', label: 'Pages' },
          ]}
        />

        {mode === 'chapters' && hasChapters && (
          <>
            <div className="download-field-row">
              <ChapterSelectField label="From" chapters={chapters} value={fromChapter} onChange={setFromChapter} />
              <span className="download-field-arrow">→</span>
              <ChapterSelectField label="To" chapters={chapters} value={toChapter} onChange={setToChapter} />
            </div>
            <div className="download-chip-row">
              <button type="button" className="download-chip" onClick={() => applyChapterChip('this')}>
                This chapter
              </button>
              <button type="button" className="download-chip" onClick={() => applyChapterChip('next10')}>
                Next 10 chapters
              </button>
              <button type="button" className="download-chip" onClick={() => applyChapterChip('next25')}>
                Next 25
              </button>
              <button type="button" className="download-chip" onClick={() => applyChapterChip('rest')}>
                Rest of book
              </button>
            </div>
          </>
        )}

        {mode === 'pages' && (
          <>
            <div className="download-field-row">
              <label className="field download-field">
                <span className="field-label download-field-label">From page</span>
                <span className="download-page-input">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={totalPages || 1}
                    value={fromPage}
                    onChange={(e) => setFromPage(Number(e.target.value))}
                  />
                </span>
              </label>
              <span className="download-field-arrow">→</span>
              <label className="field download-field">
                <span className="field-label download-field-label">To page</span>
                <span className="download-page-input">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={totalPages || 1}
                    value={toPage}
                    onChange={(e) => setToPage(Number(e.target.value))}
                  />
                  <span className="download-page-input-total">of {totalPages}</span>
                </span>
              </label>
            </div>
            <div className="download-chip-row">
              <button type="button" className="download-chip" onClick={() => applyPageChip('current')}>
                From current page ({currentPageNumber})
              </button>
              <button type="button" className="download-chip" onClick={() => applyPageChip('next50')}>
                Next 50 pages
              </button>
              <button type="button" className="download-chip" onClick={() => applyPageChip('next100')}>
                Next 100
              </button>
              <button type="button" className="download-chip" onClick={() => applyPageChip('end')}>
                To the end
              </button>
            </div>
          </>
        )}

        <div className="download-field-row download-voice-row">
          <span className="field-label">Voice</span>
          <VoiceSelectField voices={availableVoices} value={voiceURI} onChange={setVoiceURI} selectedName={selectedVoice?.name} />
        </div>

        <div className="download-summary">
          <div className="download-summary-bar" role="img" aria-label="How much of the book is already saved, newly selected, and remaining">
            {alreadySavedFraction > 0 && <span className="download-summary-segment download-summary-saved" style={{ flex: alreadySavedFraction }} />}
            {newFraction > 0 && <span className="download-summary-segment download-summary-new" style={{ flex: newFraction }} />}
            {restFraction > 0 && <span className="download-summary-segment download-summary-rest" style={{ flex: restFraction }} />}
          </div>
          <div className="download-summary-legend">
            {savedCharSpan && (
              <span className="download-summary-legend-item">
                <span className="download-summary-dot download-summary-dot-saved" />
                Already saved · {unitLabel(savedCharSpan.charStart, savedCharSpan.charEnd)}
              </span>
            )}
            {newCharSpan && (
              <span className="download-summary-legend-item">
                <span className="download-summary-dot download-summary-dot-new" />
                New · {unitLabel(newCharSpan.charStart, newCharSpan.charEnd)}
              </span>
            )}
          </div>
          <div className="download-summary-stats">{summaryStats.filter(Boolean).join(' · ')}</div>
          {mode === 'pages' && <div className="download-summary-hint">Starts and ends on whole paragraphs, so it may run a few lines past the page you chose.</div>}
          {alreadyFullyCovered && <div className="download-summary-hint">Already downloaded.</div>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={alreadyFullyCovered || enqueuing || !selectedChunkRange} onClick={handleDownload}>
            <DownloadIcon width={16} height={16} />
            {alreadyFullyCovered ? 'Already downloaded' : downloadLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function spanOf(ranges: ChunkIndexRange[], charRanges: { charStart: number; charEnd: number }[]): { charStart: number; charEnd: number } {
  const charStart = Math.min(...ranges.map((r) => charRanges[r.fromChunkIndex]?.charStart ?? 0));
  const charEnd = Math.max(...ranges.map((r) => charRanges[r.toChunkIndex]?.charEnd ?? 0));
  return { charStart, charEnd };
}

function ChapterSelectField({
  label,
  chapters,
  value,
  onChange,
}: {
  label: string;
  chapters: ChapterRef[];
  value: number;
  onChange: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const showSearch = chapters.length > 20;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = chapters
    .map((chapter, i) => ({ number: i + 1, title: chapter.title }))
    .filter((c) => !q || c.title.toLowerCase().includes(q) || String(c.number).includes(q));

  const selected = chapters[value - 1];

  return (
    <label className="field download-field">
      <span className="field-label download-field-label">{label}</span>
      <div className="menu-wrapper menu-wrapper-block" ref={wrapperRef}>
        <button type="button" className="btn btn-secondary download-select" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="download-select-text">
            Ch. {value}
            {selected && <span className="download-select-muted"> · {selected.title}</span>}
          </span>
          <ChevronDownIcon width={14} height={14} />
        </button>
        {open && (
          <div className="menu-panel card download-chapter-panel" role="menu">
            {showSearch && (
              <input
                className="input download-chapter-search"
                placeholder="Search chapters…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            )}
            <div className="download-chapter-list">
              {filtered.map((c) => (
                <button
                  key={c.number}
                  type="button"
                  role="menuitem"
                  className={`menu-item${c.number === value ? ' menu-item-selected' : ''}`}
                  onClick={() => {
                    onChange(c.number);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  Ch. {c.number} <span className="download-select-muted">· {c.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </label>
  );
}

function VoiceSelectField({
  voices,
  value,
  onChange,
  selectedName,
}: {
  voices: { voiceURI: string; name: string; localService: boolean }[];
  value: string;
  onChange: (uri: string) => void;
  selectedName: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const selected = voices.find((v) => v.voiceURI === value);

  return (
    <div className="menu-wrapper" ref={wrapperRef}>
      <button type="button" className="btn btn-secondary download-select download-voice-select" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {selected ? `${selected.name} · ${selected.localService ? 'on-device' : 'online'}` : (selectedName ?? 'Select a voice')}
        <ChevronDownIcon width={14} height={14} />
      </button>
      {open && (
        <div className="menu-panel card" role="menu">
          {voices.map((voice) => (
            <button
              key={voice.voiceURI}
              type="button"
              role="menuitem"
              className={`menu-item${voice.voiceURI === value ? ' menu-item-selected' : ''}`}
              onClick={() => {
                onChange(voice.voiceURI);
                setOpen(false);
              }}
            >
              {voice.name} · {voice.localService ? 'on-device' : 'online'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

