import type { ChapterDetectionMode } from '@lingxi/core';
import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ListIcon } from '../components/icons';
import { useChapterDetection } from '../settings/useChapterDetection';
import { ThemeToggle } from '../theme/ThemeToggle';
import { type NavKey, Sidebar } from './Sidebar';

interface SettingsScreenProps {
  onNavigate: (nav: NavKey) => void;
}

const MODE_OPTIONS: { value: ChapterDetectionMode; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Detect chapters automatically',
    description: 'Looks for headings that start with "Chapter" or "Part" followed by a number (e.g. "Chapter 5").',
  },
  {
    value: 'off',
    label: "Don't show chapters",
    description: 'Always show paragraph/page progress instead, even if the book has headings.',
  },
  {
    value: 'custom',
    label: 'Custom format',
    description: 'Tell it what a chapter heading looks like in your book.',
  },
];

export function SettingsScreen({ onNavigate }: SettingsScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings, setSettings } = useChapterDetection();

  return (
    <div className="app-shell-with-sidebar">
      <Sidebar active="settings" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-shell-content">
        <AppShell
          start={
            <>
              <button
                type="button"
                className="btn btn-icon sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <ListIcon />
              </button>
              <span className="brand">Settings</span>
            </>
          }
          end={<ThemeToggle />}
        >
          <div className="library-page">
            <section>
              <div className="library-section-header">
                <h1 className="library-section-title">Chapter separation</h1>
              </div>
              <p className="status-message" style={{ marginBottom: 'var(--space-4)' }}>
                Controls how the reader and library figure out which chapter you're on. This applies to every book,
                not just one.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {MODE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="card"
                    style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="chapter-detection-mode"
                      checked={settings.mode === option.value}
                      onChange={() => setSettings({ ...settings, mode: option.value })}
                      style={{ marginTop: '3px' }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: 600 }}>{option.label}</span>
                      <span className="document-card-filename">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              {settings.mode === 'custom' && (
                <div className="field" style={{ marginTop: 'var(--space-4)', maxWidth: '24rem' }}>
                  <label className="field-label" htmlFor="chapter-prefix">
                    Heading word (leave blank if chapters are just a number, e.g. "301 Title")
                  </label>
                  <input
                    id="chapter-prefix"
                    className="input"
                    placeholder="e.g. Section, Episode"
                    value={settings.customPrefix}
                    onChange={(e) => setSettings({ ...settings, customPrefix: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              )}
            </section>
          </div>
        </AppShell>
      </div>
    </div>
  );
}
