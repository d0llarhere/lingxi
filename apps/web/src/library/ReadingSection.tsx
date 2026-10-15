import { SegmentedControl } from '../components/SegmentedControl';
import { Switch } from '../components/Switch';
import { useReadingSettings, type ReadingSettings } from '../settings/useReadingSettings';
import { ReadingPreview } from './ReadingPreview';

export function ReadingSection() {
  const { settings, setSettings } = useReadingSettings();

  function update<K extends keyof ReadingSettings>(key: K, value: ReadingSettings[K]) {
    setSettings({ ...settings, [key]: value });
  }

  return (
    <div>
      <div>
        <h1 className="settings-h1">Reading</h1>
        <p className="settings-intro">How book text looks in the reader.</p>
      </div>

      <ReadingPreview highlightMode={settings.highlightMode} />

      <section className="settings-section">
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Font size</div>
            </div>
            <div className="field-slider-row">
              <span aria-hidden="true" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                A
              </span>
              <input
                type="range"
                min={14}
                max={28}
                value={settings.fontSizePx}
                onChange={(e) => update('fontSizePx', Number(e.target.value))}
                aria-label="Font size"
              />
              <span aria-hidden="true" style={{ fontSize: 18, color: 'var(--text-muted)' }}>
                A
              </span>
              <span className="field-slider-value">{settings.fontSizePx}px</span>
            </div>
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Line spacing</div>
            </div>
            <SegmentedControl
              ariaLabel="Line spacing"
              value={settings.lineSpacing}
              onChange={(v) => update('lineSpacing', v)}
              options={[
                { value: 'tight', label: 'Tight' },
                { value: 'normal', label: 'Normal' },
                { value: 'loose', label: 'Loose' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Text width</div>
            </div>
            <SegmentedControl
              ariaLabel="Text width"
              value={settings.textWidth}
              onChange={(v) => update('textWidth', v)}
              options={[
                { value: 'narrow', label: 'Narrow' },
                { value: 'medium', label: 'Medium' },
                { value: 'wide', label: 'Wide' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Paragraph spacing</div>
            </div>
            <SegmentedControl
              ariaLabel="Paragraph spacing"
              value={settings.paragraphSpacing}
              onChange={(v) => update('paragraphSpacing', v)}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Alignment</div>
            </div>
            <SegmentedControl
              ariaLabel="Alignment"
              value={settings.alignment}
              onChange={(v) => update('alignment', v)}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'justified', label: 'Justified' },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Font</div>
            </div>
            <SegmentedControl
              ariaLabel="Font"
              value={settings.fontFamily}
              onChange={(v) => update('fontFamily', v)}
              options={[
                { value: 'serif', label: <span style={{ fontFamily: 'var(--font-reading-serif)' }}>Serif</span> },
                { value: 'sans', label: <span style={{ fontFamily: 'var(--font-ui)' }}>Sans</span> },
                {
                  value: 'easy-read',
                  label: <span style={{ fontFamily: '"Atkinson Hyperlegible", sans-serif' }}>Easy-read</span>,
                },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Highlight while listening</div>
            </div>
            <SegmentedControl
              ariaLabel="Highlight while listening"
              value={settings.highlightMode}
              onChange={(v) => update('highlightMode', v)}
              options={[
                { value: 'sentence-word', label: 'Sentence + word' },
                { value: 'sentence', label: 'Sentence' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>

          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Auto-scroll to follow the voice</div>
              <div className="storage-row-desc">Pauses for a few seconds when you scroll yourself</div>
            </div>
            <Switch checked={settings.autoScroll} onChange={(v) => update('autoScroll', v)} ariaLabel="Auto-scroll" />
          </div>
        </div>
      </section>
    </div>
  );
}
