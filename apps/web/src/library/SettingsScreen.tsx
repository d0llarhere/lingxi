import { detectChapters, type ChapterDetectionMode, type ChapterRef, type LingxiDocument } from '@lingxi/core';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangleIcon, CheckIcon, ListIcon } from '../components/icons';
import { useChapterDetection } from '../settings/useChapterDetection';
import { type NavKey, Sidebar } from './Sidebar';
import { StorageSection } from './StorageSection';
import { useLibrary } from './LibraryProvider';

export type SettingsSection = 'chapters' | 'storage';

interface SettingsScreenProps {
  onNavigate: (nav: NavKey, settingsSection?: SettingsSection) => void;
  initialSection?: SettingsSection;
}

const MODE_OPTIONS: { value: ChapterDetectionMode; label: string; description: string; example: string }[] = [
  {
    value: 'auto',
    label: 'Automatic',
    description: 'Finds headings that start with "Chapter" or "Part" and a number.',
    example: 'Chapter 5',
  },
  {
    value: 'custom',
    label: 'Custom format',
    description: 'Describe what a heading looks like in your books.',
    example: '1 Swindler',
  },
  {
    value: 'off',
    label: 'Off',
    description: 'Show page and paragraph progress only.',
    example: 'p. 12 / 665',
  },
];

const PRESETS: { label: string; prefix: string }[] = [
  { label: 'Just a number', prefix: '' },
  { label: 'Chapter', prefix: 'Chapter' },
  { label: 'Part', prefix: 'Part' },
  { label: 'Episode', prefix: 'Episode' },
  { label: 'Section', prefix: 'Section' },
];

function syntheticExample(customPrefix: string): string {
  const prefix = customPrefix.trim();
  return prefix ? `${prefix} 5 Title` : '301 Title';
}

function pageNumberFor(pages: { index: number; charStart: number }[], charStart: number): number {
  let page = 1;
  for (const p of pages) {
    if (p.charStart <= charStart) page = p.index + 1;
    else break;
  }
  return page;
}

// Deliberately looser than detectChapters' real pattern — this only runs
// when the real pattern already found nothing, to surface a plausible
// candidate line for the "No chapters found" card. Capped to the first
// 200k characters so a huge book doesn't scan to the end just to fail.
function findHeadingLikeLine(text: string): string | null {
  const lines = text.slice(0, 200_000).split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.length > 60) continue;
    if (/^(?:\d+|[A-Z][a-zA-Z]*)\s+\S/.test(line)) return line;
  }
  return null;
}

function suggestFromHeadingLike(line: string): { label: string; prefix: string } | null {
  if (/^\d+\s+\S/.test(line)) return { label: 'number + title', prefix: '' };
  const wordMatch = line.match(/^([A-Za-z]+)\s+(?:\d+|[IVXLCDM]+)\b/);
  if (wordMatch) return { label: `"${wordMatch[1]}" + number`, prefix: wordMatch[1]! };
  return null;
}

export function SettingsScreen({ onNavigate, initialSection }: SettingsScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'chapters');
  const { settings, setSettings } = useChapterDetection();
  const { repository } = useLibrary();
  const radioRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [testBooks, setTestBooks] = useState<LingxiDocument[] | null>(null);
  const [testBookId, setTestBookId] = useState<string | null>(null);
  const [testText, setTestText] = useState<string | null>(null);
  const [testChapters, setTestChapters] = useState<ChapterRef[] | null>(null);
  const [showAllMatches, setShowAllMatches] = useState(false);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    repository.listDocuments().then((docs) => {
      if (cancelled) return;
      setTestBooks(docs);
      setTestBookId((current) => current ?? docs[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    if (!repository || !testBookId) {
      setTestText(null);
      return;
    }
    let cancelled = false;
    repository.getDocumentText(testBookId).then((text) => {
      if (!cancelled) setTestText(text ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, testBookId]);

  // Debounced re-detection — re-runs 300ms after the mode, the custom word
  // or the selected test book settles, not on every keystroke.
  useEffect(() => {
    if (!testText) {
      setTestChapters(null);
      return;
    }
    const handle = setTimeout(() => {
      setTestChapters(detectChapters(testText, settings));
      setShowAllMatches(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [testText, settings.mode, settings.customPrefix]);

  const testBook = testBooks?.find((doc) => doc.id === testBookId) ?? null;
  const headingLikeLine = useMemo(() => (testText ? findHeadingLikeLine(testText) : null), [testText]);
  const suggestion = useMemo(() => (headingLikeLine ? suggestFromHeadingLike(headingLikeLine) : null), [headingLikeLine]);
  const hintExample = testChapters && testChapters.length > 0 ? testChapters[0]!.title : syntheticExample(settings.customPrefix);

  function handleRadioKeyDown(e: KeyboardEvent<HTMLDivElement>, index: number) {
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !backward) return;
    e.preventDefault();
    const nextIndex = forward ? (index + 1) % MODE_OPTIONS.length : (index - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    const next = MODE_OPTIONS[nextIndex]!;
    setSettings({ ...settings, mode: next.value });
    radioRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="app-shell-with-sidebar">
      <Sidebar active="settings" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-shell-content">
        <div className="settings-mobile-bar">
          <button
            type="button"
            className="btn btn-icon sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <ListIcon />
          </button>
        </div>

        <div className="settings-layout">
          <nav aria-label="Settings sections" className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {/* Only Chapters and Storage have settings defined yet — the
                brief's own rule is to leave undefined sections out of the
                nav rather than show an empty page for Reading/Listening/etc. */}
            <button
              type="button"
              className={`settings-nav-item${section === 'chapters' ? ' settings-nav-item-active' : ''}`}
              onClick={() => setSection('chapters')}
            >
              Chapters
            </button>
            <button
              type="button"
              className={`settings-nav-item${section === 'storage' ? ' settings-nav-item-active' : ''}`}
              onClick={() => setSection('storage')}
            >
              Storage
            </button>
          </nav>

          {section === 'storage' ? (
            <main className="settings-main">
              <StorageSection onOpenLibrary={() => onNavigate('library')} />
            </main>
          ) : (
          <main className="settings-main">
            <div>
              <h1 className="settings-h1">Chapters</h1>
              <p className="settings-intro">
                How the reader, player and library figure out which chapter you're on. Applies to every book.
              </p>
            </div>

            <section className="settings-section">
              <span className="settings-caption">How chapters are found</span>
              <div role="radiogroup" aria-label="Chapter detection" className="chapters-group">
                {MODE_OPTIONS.map((option, i) => {
                  const isSelected = settings.mode === option.value;
                  const isCustomExpanded = option.value === 'custom' && isSelected;
                  return (
                    <div key={option.value}>
                      <div className={`chapters-option${isSelected ? ' chapters-option-selected' : ''}`}>
                        <div
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          className="chapters-option-row"
                          onClick={() => setSettings({ ...settings, mode: option.value })}
                          onKeyDown={(e) => handleRadioKeyDown(e, i)}
                          ref={(el) => {
                            radioRefs.current[i] = el;
                          }}
                        >
                          <span className="chapters-radio">{isSelected && <span className="chapters-radio-dot" />}</span>
                          <div className="chapters-option-text">
                            <div className="chapters-option-title">{option.label}</div>
                            <div className="chapters-option-desc">{option.description}</div>
                          </div>
                          {!isCustomExpanded && <span className="chapters-example">{option.example}</span>}
                        </div>

                        {isCustomExpanded && (
                          <div className="chapters-custom-body">
                            <div className="chapters-preset-group">
                              <span className="chapters-field-label">Headings start with</span>
                              <div className="chapters-preset-row">
                                {PRESETS.map((preset) => {
                                  const active = settings.customPrefix.trim().toLowerCase() === preset.prefix.trim().toLowerCase();
                                  return (
                                    <button
                                      key={preset.label}
                                      type="button"
                                      className={`chapters-preset-chip${active ? ' chapters-preset-chip-active' : ''}`}
                                      onClick={() => setSettings({ ...settings, customPrefix: preset.prefix })}
                                    >
                                      {preset.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <label className="chapters-word-field">
                              <span className="chapters-field-label">
                                Heading word <span className="chapters-field-label-optional">(optional)</span>
                              </span>
                              <input
                                className="input"
                                placeholder="Other word, e.g. Volume"
                                value={settings.customPrefix}
                                onChange={(e) => setSettings({ ...settings, customPrefix: e.target.value })}
                                autoComplete="off"
                                aria-describedby="chapters-hint"
                              />
                            </label>

                            <div id="chapters-hint" className="chapters-hint">
                              Will match headings like <span className="chapters-example">{hintExample}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      {i < MODE_OPTIONS.length - 1 && <div className="chapters-divider" />}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="settings-section">
              <div className="test-book-row">
                <span className="settings-caption">Test on a book</span>
                {testBooks && testBooks.length > 0 && (
                  <select
                    className="select"
                    aria-label="Book to test"
                    value={testBookId ?? ''}
                    onChange={(e) => setTestBookId(e.target.value)}
                  >
                    {testBooks.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {!testBooks || testBooks.length === 0 ? (
                <p className="status-message">Add a book to your library to test chapter detection.</p>
              ) : testChapters === null ? (
                <p className="status-message">Checking…</p>
              ) : testChapters.length === 0 ? (
                <div className="test-result-card is-warn">
                  <AlertTriangleIcon width={20} height={20} className="test-result-icon" />
                  <div className="test-result-body">
                    <div className="test-result-title">No chapters found</div>
                    {headingLikeLine ? (
                      <>
                        <p className="test-result-desc">
                          {suggestion
                            ? `This book's headings look like "${suggestion.label}", but the current setting doesn't match them.`
                            : "This book's headings don't match the current setting, and this line didn't fit a common pattern either."}
                        </p>
                        <div className="test-result-quote">
                          <mark>{headingLikeLine}</mark>
                          <span className="test-result-quote-caption"> — closest match to a heading</span>
                        </div>
                        {suggestion && (
                          <div>
                            <button
                              type="button"
                              className="test-result-action"
                              onClick={() => setSettings({ mode: 'custom', customPrefix: suggestion.prefix })}
                            >
                              Use "{suggestion.label}" format
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="test-result-desc">This book doesn't seem to have chapter headings at all.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="test-result-card is-found">
                  <div className="test-result-header">
                    <CheckIcon width={18} height={18} />
                    <span className="test-result-count">
                      {testChapters.length} chapter{testChapters.length === 1 ? '' : 's'} found
                    </span>
                    {testChapters.length > 3 && (
                      <button type="button" className="test-result-viewall" onClick={() => setShowAllMatches((v) => !v)}>
                        {showAllMatches ? 'Show fewer' : 'View all'}
                      </button>
                    )}
                  </div>
                  {(showAllMatches ? testChapters : testChapters.slice(0, 3)).map((chapter, i) => (
                    <div key={chapter.charStart} className="test-result-row">
                      <span className="test-result-row-num">Ch. {i + 1}</span>
                      <span className="test-result-row-title">{chapter.title}</span>
                      <span className="test-result-row-page">p. {pageNumberFor(testBook?.structure.pages ?? [], chapter.charStart)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="settings-footer">
              <CheckIcon width={14} height={14} />
              Changes save automatically
            </div>
          </main>
          )}
        </div>
      </div>
    </div>
  );
}
