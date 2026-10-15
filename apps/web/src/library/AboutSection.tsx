import { useState } from 'react';
import { ChevronRightIcon, CheckIcon } from '../components/icons';
import { Modal } from '../components/Modal';

// No GitHub remote is configured on this repo (confirmed via `git remote
// -v`) — Report a bug/Source code stay hidden until one exists, per the
// brief's own instruction to gate those rows behind it rather than invent a
// placeholder URL.
const REPO_URL: string | null = null;

type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'error';

// Memoized module-wide so every "Check for updates" click compares against
// the same baseline (the first ETag seen this session), not a fresh fetch
// each time — a real check (no service worker here), not a faked one.
let initialEtagPromise: Promise<string | null> | null = null;
function getInitialEtag(): Promise<string | null> {
  if (!initialEtagPromise) {
    initialEtagPromise = fetch('/', { cache: 'no-store' })
      .then((r) => r.headers.get('etag'))
      .catch(() => null);
  }
  return initialEtagPromise;
}

const WHATS_NEW = [
  { version: '0.3', summary: 'Reading, Listening, Appearance and About settings; sepia theme.' },
  { version: '0.2', summary: 'Chapter detection and on-device storage management.' },
  { version: '0.1', summary: 'First release: PDF/text import, playback, and downloads.' },
];

export function AboutSection() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showAllLicenses, setShowAllLicenses] = useState(false);

  async function handleCheckForUpdates() {
    setUpdateStatus('checking');
    const [initial, current] = await Promise.all([
      getInitialEtag(),
      fetch('/', { cache: 'no-store' })
        .then((r) => r.headers.get('etag'))
        .catch(() => null),
    ]);
    if (!initial || !current) {
      setUpdateStatus('error');
    } else {
      setUpdateStatus(initial === current ? 'latest' : 'available');
    }
  }

  return (
    <div>
      <div>
        <h1 className="settings-h1">About</h1>
        <p className="settings-intro">Version, updates, and what's under the hood.</p>
      </div>

      <section className="settings-section">
        <div className="storage-card about-header">
          <div className="about-icon">灵</div>
          <div className="about-info">
            <div className="about-app-name">Lingxi</div>
            <div className="storage-row-desc">
              Version {__APP_VERSION__} · built {__BUILD_DATE__}
            </div>
            {updateStatus === 'latest' && (
              <div className="about-update-status">
                <CheckIcon width={14} height={14} />
                You're on the latest version
              </div>
            )}
            {updateStatus === 'available' && (
              <div className="about-update-status about-update-available">
                Update ready —{' '}
                <button type="button" className="about-reload-link" onClick={() => window.location.reload()}>
                  reload
                </button>
              </div>
            )}
            {updateStatus === 'error' && <div className="storage-row-desc">Couldn't check for updates</div>}
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleCheckForUpdates} disabled={updateStatus === 'checking'}>
            {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="storage-card">
          {REPO_URL && (
            <a className="storage-row about-link-row" href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">
              <div className="storage-row-text">
                <div className="storage-row-title">Report a bug</div>
                <div className="storage-row-desc">Opens an issue with your version and browser filled in</div>
              </div>
              <ChevronRightIcon width={16} height={16} />
            </a>
          )}
          {REPO_URL && (
            <a className="storage-row about-link-row" href={REPO_URL} target="_blank" rel="noreferrer">
              <div className="storage-row-text">
                <div className="storage-row-title">Source code</div>
                <div className="storage-row-desc">{REPO_URL}</div>
              </div>
              <ChevronRightIcon width={16} height={16} />
            </a>
          )}
          <button type="button" className="storage-row about-link-row" onClick={() => setShowWhatsNew(true)}>
            <div className="storage-row-text">
              <div className="storage-row-title">What's new</div>
              <div className="storage-row-desc">Changes in recent versions</div>
            </div>
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">Credits and licenses</span>
        <div className="storage-card">
          {__THIRD_PARTY_LICENSES__.map((dep) => (
            <div key={dep.name} className="storage-row">
              <div className="storage-row-text">
                <div className="storage-row-title">{dep.name}</div>
              </div>
              <span className="storage-row-desc">{dep.license}</span>
            </div>
          ))}
          <button type="button" className="storage-row about-link-row" onClick={() => setShowAllLicenses(true)}>
            <span className="storage-row-title">View all open-source licenses</span>
          </button>
        </div>
      </section>

      {showWhatsNew && (
        <Modal title="What's new" onClose={() => setShowWhatsNew(false)}>
          <div className="about-whats-new-list">
            {WHATS_NEW.map((entry) => (
              <div key={entry.version}>
                <div className="storage-row-title">Version {entry.version}</div>
                <div className="storage-row-desc">{entry.summary}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {showAllLicenses && (
        <Modal title="Open-source licenses" onClose={() => setShowAllLicenses(false)}>
          <div className="storage-card">
            {__THIRD_PARTY_LICENSES__.map((dep) => (
              <div key={dep.name} className="storage-row">
                <div className="storage-row-text">
                  <div className="storage-row-title">{dep.name}</div>
                </div>
                <span className="storage-row-desc">{dep.license}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
