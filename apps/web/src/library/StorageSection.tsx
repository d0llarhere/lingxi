import type { AudioItemRecord } from '@lingxi/core';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast } from '../components/Toast';
import { getSegmentCacheRepository } from '../tts/segmentCacheInstance';
import { kokoroEngine } from '../tts/ttsEngineInstance';
import { getAudioLibraryRepository } from './audioLibraryInstance';
import { useLibrary } from './LibraryProvider';
import { formatBytes } from './StorageCard';

// The browser's Cache Storage API doesn't expose a cache's total byte size
// without enumerating and reading every response body — not worth doing
// just for a settings display number. Same ~93MB figure already quoted in
// KokoroTTSEngine.ts's own comments.
const KOKORO_MODEL_ESTIMATED_BYTES = 93 * 1024 * 1024;

type PendingAction =
  | { kind: 'delete-kind'; audioKind: AudioItemRecord['kind']; label: string }
  | { kind: 'remove-kokoro' }
  | { kind: 'delete-selected' };

interface StorageSectionProps {
  onOpenLibrary: () => void;
}

export function StorageSection({ onOpenLibrary }: StorageSectionProps) {
  const { repository } = useLibrary();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [audioItems, setAudioItems] = useState<AudioItemRecord[] | null>(null);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [bookFilesSize, setBookFilesSize] = useState<number | null>(null);
  const [kokoroReady, setKokoroReady] = useState(kokoroEngine.getStatusSnapshot().status === 'ready');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const [audioRepo, cacheRepo] = await Promise.all([getAudioLibraryRepository(), getSegmentCacheRepository()]);
    const [items, cache, books] = await Promise.all([
      audioRepo.listAudioItems(),
      cacheRepo.getTotalSize(),
      repository?.getBookFilesSize() ?? Promise.resolve(0),
    ]);
    setAudioItems(items);
    setCacheSize(cache);
    setBookFilesSize(books);
    if (navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((result) => setEstimate({ usage: result.usage ?? 0, quota: result.quota ?? 0 }))
        .catch(() => setEstimate(null));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  useEffect(() => kokoroEngine.subscribe((snapshot) => setKokoroReady(snapshot.status === 'ready')), []);

  const downloadedAudio = audioItems?.filter((item) => item.kind === 'book') ?? [];
  const importedAudio = audioItems?.filter((item) => item.kind === 'imported') ?? [];
  const downloadedBytes = downloadedAudio.reduce((sum, item) => sum + item.sizeBytes, 0);
  const importedBytes = importedAudio.reduce((sum, item) => sum + item.sizeBytes, 0);
  const kokoroBytes = kokoroReady ? KOKORO_MODEL_ESTIMATED_BYTES : 0;

  const categories = [
    { key: 'downloaded', dot: 'var(--accent)', bytes: downloadedBytes },
    { key: 'imported', dot: 'var(--warn)', bytes: importedBytes },
    { key: 'voice', dot: '#8fb4e8', bytes: kokoroBytes },
    { key: 'books', dot: '#cbbef0', bytes: bookFilesSize ?? 0 },
    { key: 'cache', dot: 'var(--text-muted)', bytes: cacheSize ?? 0 },
  ];
  const quota = estimate?.quota ?? 0;

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedBytes = (audioItems ?? []).filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.sizeBytes, 0);

  async function runPendingAction() {
    if (!pendingAction) return;
    const audioRepo = await getAudioLibraryRepository();
    let freedBytes = 0;

    if (pendingAction.kind === 'delete-kind') {
      freedBytes = await audioRepo.deleteAllByKind(pendingAction.audioKind);
    } else if (pendingAction.kind === 'remove-kokoro') {
      await kokoroEngine.remove();
      freedBytes = KOKORO_MODEL_ESTIMATED_BYTES;
    } else {
      freedBytes = await audioRepo.deleteMany([...selected]);
      setSelected(new Set());
    }

    setPendingAction(null);
    setToast(`Freed ${formatBytes(freedBytes)}`);
    await refresh();
  }

  async function handleClearCache() {
    const freedBytes = cacheSize ?? 0;
    const cacheRepo = await getSegmentCacheRepository();
    await cacheRepo.clear();
    setToast(`Freed ${formatBytes(freedBytes)}`);
    await refresh();
  }

  function describePendingAction(action: PendingAction): { title: string; message: string } {
    if (action.kind === 'delete-kind') {
      const bytes = action.audioKind === 'book' ? downloadedBytes : importedBytes;
      return { title: `Delete all ${action.label.toLowerCase()}`, message: `This frees ${formatBytes(bytes)}. This cannot be undone.` };
    }
    if (action.kind === 'remove-kokoro') {
      return {
        title: 'Remove voice model',
        message: `This frees about ${formatBytes(KOKORO_MODEL_ESTIMATED_BYTES)}. You can re-download it any time.`,
      };
    }
    return {
      title: 'Delete selected audio',
      message: `Delete ${selected.size} item${selected.size === 1 ? '' : 's'}? This frees ${formatBytes(selectedBytes)}. This cannot be undone.`,
    };
  }

  const pendingCopy = pendingAction ? describePendingAction(pendingAction) : null;

  return (
    <div>
      <div>
        <h1 className="settings-h1">Storage</h1>
        <p className="settings-intro">Everything Lingxi keeps on this device.</p>
      </div>

      <section className="settings-section storage-summary">
        <div className="storage-summary-figure">
          <span className="storage-summary-used">{formatBytes(estimate?.usage ?? 0)}</span>
          <span className="storage-summary-available">used of {formatBytes(estimate?.quota ?? 0)} available</span>
        </div>
        <div role="img" aria-label="Storage use by category" className="storage-bar">
          {categories.map((category) => (
            <span
              key={category.key}
              className="storage-bar-segment"
              style={{ width: `${quota > 0 ? (category.bytes / quota) * 100 : 0}%`, background: category.dot }}
            />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">What's using space</span>
        <div className="storage-card">
          <div className="storage-row">
            <span className="storage-dot" style={{ background: 'var(--accent)' }} />
            <div className="storage-row-text">
              <div className="storage-row-title">Downloaded audio</div>
              <div className="storage-row-desc">Audio saved from your books · {downloadedAudio.length} items</div>
            </div>
            <span className="storage-row-size">{formatBytes(downloadedBytes)}</span>
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={downloadedAudio.length === 0}
              onClick={() => setPendingAction({ kind: 'delete-kind', audioKind: 'book', label: 'Downloaded audio' })}
            >
              Delete all…
            </button>
          </div>
          <div className="storage-row">
            <span className="storage-dot" style={{ background: 'var(--warn)' }} />
            <div className="storage-row-text">
              <div className="storage-row-title">Imported audio</div>
              <div className="storage-row-desc">Files you added in Downloads · {importedAudio.length} items</div>
            </div>
            <span className="storage-row-size">{formatBytes(importedBytes)}</span>
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={importedAudio.length === 0}
              onClick={() => setPendingAction({ kind: 'delete-kind', audioKind: 'imported', label: 'Imported audio' })}
            >
              Delete all…
            </button>
          </div>
          <div className="storage-row">
            <span className="storage-dot" style={{ background: '#8fb4e8' }} />
            <div className="storage-row-text">
              <div className="storage-row-title">Voice model</div>
              <div className="storage-row-desc">Kokoro on-device voices · re-download any time</div>
            </div>
            <span className="storage-row-size">{formatBytes(kokoroBytes)}</span>
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={!kokoroReady}
              onClick={() => setPendingAction({ kind: 'remove-kokoro' })}
            >
              Remove
            </button>
          </div>
          <div className="storage-row">
            <span className="storage-dot" style={{ background: '#cbbef0' }} />
            <div className="storage-row-text">
              <div className="storage-row-title">Book files</div>
              <div className="storage-row-desc">Your PDFs and text files · delete from Library</div>
            </div>
            <span className="storage-row-size">{formatBytes(bookFilesSize ?? 0)}</span>
            <button type="button" className="btn btn-secondary" onClick={onOpenLibrary}>
              Open Library
            </button>
          </div>
          <div className="storage-row">
            <span className="storage-dot" style={{ background: 'var(--text-muted)' }} />
            <div className="storage-row-text">
              <div className="storage-row-title">Cache</div>
              <div className="storage-row-desc">Temporary audio and page images · safe to clear</div>
            </div>
            <span className="storage-row-size">{formatBytes(cacheSize ?? 0)}</span>
            <button type="button" className="btn btn-secondary" disabled={!cacheSize} onClick={handleClearCache}>
              Clear
            </button>
          </div>
        </div>
      </section>

      {audioItems && audioItems.length > 0 && (
        <section className="settings-section">
          <div className="storage-audio-header">
            <span className="settings-caption">Audio files</span>
            {selected.size > 0 && (
              <div className="storage-audio-selection">
                <span className="storage-audio-selection-count">
                  {selected.size} selected · {formatBytes(selectedBytes)}
                </span>
                <button type="button" className="btn btn-danger-outline" onClick={() => setPendingAction({ kind: 'delete-selected' })}>
                  Delete selected
                </button>
              </div>
            )}
          </div>
          <div className="storage-card">
            {audioItems.map((item) => (
              <label key={item.id} className="storage-row">
                <input
                  type="checkbox"
                  className="storage-checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                  aria-label={`Select ${item.title}`}
                />
                <div className="storage-row-text">
                  <div className="storage-row-title">{item.title}</div>
                  <div className="storage-row-desc">
                    {item.kind === 'book'
                      ? `From book · ${item.chapterLabel ?? 'Whole book'}`
                      : item.subtitleFilename
                        ? 'Imported · with subtitles'
                        : 'Imported'}
                  </div>
                </div>
                <span className="storage-row-size">{formatBytes(item.sizeBytes)}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {pendingAction && pendingCopy && (
        <ConfirmDialog
          title={pendingCopy.title}
          message={pendingCopy.message}
          confirmLabel={pendingAction.kind === 'remove-kokoro' ? 'Remove' : 'Delete'}
          danger
          onConfirm={runPendingAction}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
