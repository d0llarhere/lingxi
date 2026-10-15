import type { VoiceInfo } from '@lingxi/core';
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, PlayIcon } from '../components/icons';
import { SegmentedControl } from '../components/SegmentedControl';
import { Switch } from '../components/Switch';
import { filterVoicesByOnlinePolicy, type ListeningDefaults, useListeningDefaults } from '../settings/useListeningDefaults';
import { previewVoice } from '../tts/previewVoice';
import { kokoroEngine, ttsEngine } from '../tts/ttsEngineInstance';

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: VoiceInfo[];
  value: string | null;
  onChange: (voiceURI: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = voices.find((v) => v.voiceURI === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="voice-picker-row">
      <button
        type="button"
        className="btn btn-icon btn-secondary"
        aria-label={selected ? `Preview ${selected.name}` : 'Preview voice'}
        disabled={!selected}
        onClick={() => selected && previewVoice(selected.voiceURI)}
      >
        <PlayIcon width={12} height={12} />
      </button>
      <div className="menu-wrapper" ref={wrapperRef}>
        <button type="button" className="btn btn-secondary voice-picker-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="voice-picker-avatar">{selected ? avatarInitial(selected.name) : '•'}</span>
          <span>{selected ? `${selected.name} · ${selected.localService ? 'on-device' : 'online'}` : 'Default voice'}</span>
          <ChevronDownIcon width={14} height={14} />
        </button>
        {open && (
          <div className="menu-panel card" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="voice-picker-avatar">•</span>
              Default voice
            </button>
            {voices.map((voice) => (
              <button
                key={voice.voiceURI}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  onChange(voice.voiceURI);
                  setOpen(false);
                }}
              >
                <span className="voice-picker-avatar">{avatarInitial(voice.name)}</span>
                {voice.name} · {voice.localService ? 'on-device' : 'online'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ListeningSection() {
  const { defaults, setDefaults } = useListeningDefaults();
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const [kokoroStatus, setKokoroStatus] = useState(kokoroEngine.getStatusSnapshot());

  useEffect(() => {
    ttsEngine.listVoices().then(setAllVoices);
  }, []);

  useEffect(() => kokoroEngine.subscribe(setKokoroStatus), []);

  function update<K extends keyof ListeningDefaults>(key: K, value: ListeningDefaults[K]) {
    setDefaults({ ...defaults, [key]: value });
  }

  function handleAllowOnlineVoicesChange(allow: boolean) {
    if (allow) {
      update('allowOnlineVoices', true);
      return;
    }
    // Falls back the *default* voice only — an already-open book keeps its
    // own saved selection, per the brief's "defaults for new books" scope.
    const current = allVoices.find((v) => v.voiceURI === defaults.defaultVoiceURI);
    if (!current || current.localService) {
      setDefaults({ ...defaults, allowOnlineVoices: false });
      return;
    }
    const firstOnDevice = allVoices.find((v) => v.localService);
    setDefaults({ ...defaults, allowOnlineVoices: false, defaultVoiceURI: firstOnDevice?.voiceURI ?? null });
  }

  const visibleVoices = filterVoicesByOnlinePolicy(allVoices, defaults.allowOnlineVoices);
  const hasOnDeviceVoice = allVoices.some((v) => v.localService);

  return (
    <div>
      <div>
        <h1 className="settings-h1">Listening</h1>
        <p className="settings-intro">Defaults for new books. You can still change voice and speed from the player.</p>
      </div>

      <section className="settings-section">
        <span className="settings-caption">Voice</span>
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Default voice</div>
            </div>
            <VoicePicker voices={visibleVoices} value={defaults.defaultVoiceURI} onChange={(v) => update('defaultVoiceURI', v)} />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">On-device voices (Kokoro)</div>
              <div className="storage-row-desc">
                {kokoroStatus.status === 'ready'
                  ? 'Installed · works offline'
                  : kokoroStatus.status === 'downloading'
                    ? `Downloading… ${Math.round(kokoroStatus.progress * 100)}%`
                    : kokoroStatus.status === 'error'
                      ? `Failed: ${kokoroStatus.error}`
                      : 'Not installed'}
              </div>
              {kokoroStatus.status === 'downloading' && (
                <span className="progress-track" style={{ display: 'block', marginTop: 6, width: 160 }}>
                  <span className="progress-fill" style={{ width: `${kokoroStatus.progress * 100}%` }} />
                </span>
              )}
            </div>
            {kokoroStatus.status === 'ready' ? (
              <button type="button" className="btn btn-danger-outline" onClick={() => kokoroEngine.remove()}>
                Remove
              </button>
            ) : kokoroStatus.status === 'downloading' ? (
              <button type="button" className="btn btn-secondary" disabled>
                Installing…
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => kokoroEngine.download()}>
                Install
              </button>
            )}
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Allow online voices</div>
              <div className="storage-row-desc">Voices like Aria send text to an online service</div>
            </div>
            <Switch checked={defaults.allowOnlineVoices} onChange={handleAllowOnlineVoicesChange} ariaLabel="Allow online voices" />
          </div>

          {!defaults.allowOnlineVoices && !defaults.defaultVoiceURI && !hasOnDeviceVoice && (
            <div className="storage-row">
              <p className="status-message">
                No on-device voice is installed — new books will use the system default until you install one above.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">Playback</span>
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Default speed</div>
            </div>
            <SegmentedControl
              ariaLabel="Default speed"
              value={defaults.defaultSpeed}
              onChange={(v) => update('defaultSpeed', v)}
              options={[
                { value: 0.75, label: '0.75×' },
                { value: 1, label: '1×' },
                { value: 1.25, label: '1.25×' },
                { value: 1.5, label: '1.5×' },
                { value: 1.75, label: '1.75×' },
                { value: 2, label: '2×' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Skip buttons jump by</div>
            </div>
            <SegmentedControl
              ariaLabel="Skip buttons jump by"
              value={defaults.skipBy}
              onChange={(v) => update('skipBy', v)}
              options={[
                { value: 'sentence', label: 'Sentence' },
                { value: 'paragraph', label: 'Paragraph' },
                { value: '15s', label: '15 s' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Pause between paragraphs</div>
            </div>
            <SegmentedControl
              ariaLabel="Pause between paragraphs"
              value={defaults.paragraphPause}
              onChange={(v) => update('paragraphPause', v)}
              options={[
                { value: 'none', label: 'None' },
                { value: 'short', label: 'Short' },
                { value: 'long', label: 'Long' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Skip page numbers and headers</div>
              <div className="storage-row-desc">Don't read "Page 12" or repeated running headers aloud</div>
            </div>
            <Switch checked={defaults.skipArtifacts} onChange={(v) => update('skipArtifacts', v)} ariaLabel="Skip page numbers and headers" />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">Sleep timer</span>
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Default length</div>
            </div>
            <SegmentedControl
              ariaLabel="Default sleep timer length"
              value={defaults.sleepTimerDefault}
              onChange={(v) => update('sleepTimerDefault', v)}
              options={[
                { value: 'off', label: 'Off' },
                { value: 15, label: '15' },
                { value: 30, label: '30' },
                { value: 45, label: '45' },
                { value: 60, label: '60 min' },
                { value: 'end-of-chapter', label: 'End of chapter' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Fade out at the end</div>
            </div>
            <Switch checked={defaults.fadeOutAtEnd} onChange={(v) => update('fadeOutAtEnd', v)} ariaLabel="Fade out at the end" />
          </div>
        </div>
      </section>
    </div>
  );
}
