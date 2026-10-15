import { CheckIcon } from '../components/icons';
import { SegmentedControl } from '../components/SegmentedControl';
import { ACCENT_SWATCHES, useAccentColor } from '../theme/useAccentColor';
import { useReduceMotion } from '../theme/useReduceMotion';
import { useTheme, type ThemePreference } from '../theme/useTheme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' },
];

// Preview swatches drawn inline per theme, mirroring SettingsAppearance.html's
// own hand-built mockup colors rather than reading live CSS vars — these are
// meant to show what each choice looks like independent of the one that's
// currently active.
function ThemePreview({ theme }: { theme: ThemePreference }) {
  if (theme === 'system') {
    return (
      <span className="th-pv">
        <span className="th-pv-half" style={{ background: '#f6f5f1' }}>
          <span className="th-pv-line" style={{ width: '70%', background: '#c9c6bd' }} />
          <span className="th-pv-line" style={{ width: '90%', background: '#dcd9d0' }} />
        </span>
        <span className="th-pv-half" style={{ background: '#1b1d1e' }}>
          <span className="th-pv-line" style={{ width: '70%', background: '#4a4f51' }} />
          <span className="th-pv-line" style={{ width: '90%', background: '#3a3f41' }} />
        </span>
      </span>
    );
  }
  const colors =
    theme === 'light'
      ? { bg: '#f6f5f1', line1: '#c9c6bd', line2: '#dcd9d0', pill: '#3f8f72', border: undefined }
      : theme === 'dark'
        ? { bg: '#1b1d1e', line1: '#4a4f51', line2: '#3a3f41', pill: '#7cc4a8', border: '#2e3233' }
        : { bg: '#f1e7d0', line1: '#cdbd99', line2: '#ddd0b1', pill: '#8a6a3b', border: undefined };
  return (
    <span className="th-pv th-pv-solid" style={{ background: colors.bg, border: colors.border ? `1px solid ${colors.border}` : undefined }}>
      <span className="th-pv-line" style={{ width: '60%', background: colors.line1 }} />
      <span className="th-pv-line" style={{ width: '90%', background: colors.line2 }} />
      <span className="th-pv-line" style={{ width: '80%', background: colors.line2 }} />
      <span className="th-pv-pill" style={{ background: colors.pill }} />
    </span>
  );
}

export function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  const { accentId, setAccentId } = useAccentColor();
  const { preference: motion, setPreference: setMotion } = useReduceMotion();

  const activeAccent = ACCENT_SWATCHES.find((s) => s.id === accentId) ?? ACCENT_SWATCHES[0]!;

  return (
    <div>
      <div>
        <h1 className="settings-h1">Appearance</h1>
        <p className="settings-intro">Theme and colors for the whole app.</p>
      </div>

      <section className="settings-section">
        <span className="settings-caption">Theme</span>
        <div role="radiogroup" aria-label="Theme" className="theme-grid">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preference === option.value}
              className={`th${preference === option.value ? ' th-on' : ''}`}
              onClick={() => setPreference(option.value)}
            >
              <ThemePreview theme={option.value} />
              <span className="th-label">
                {option.label}
                {preference === option.value && <CheckIcon width={16} height={16} />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">Accent color</span>
        <div className="storage-card">
          <div className="storage-row">
            <div role="radiogroup" aria-label="Accent color" className="accent-swatch-row">
              {ACCENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  role="radio"
                  aria-checked={swatch.id === accentId}
                  aria-label={swatch.label}
                  className={`sw${swatch.id === accentId ? ' sw-on' : ''}`}
                  style={{ background: swatch.hex }}
                  onClick={() => setAccentId(swatch.id)}
                >
                  {swatch.id === accentId && <CheckIcon width={16} height={16} stroke="#11241c" strokeWidth={3} />}
                </button>
              ))}
            </div>
            <span className="storage-row-desc">{activeAccent.label}</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-caption">Motion</span>
        <div className="storage-card">
          <div className="storage-row">
            <div className="storage-row-text">
              <div className="storage-row-title">Reduce motion</div>
              <div className="storage-row-desc">Turns off pill and menu animations</div>
            </div>
            <SegmentedControl
              ariaLabel="Reduce motion"
              value={motion}
              onChange={setMotion}
              options={[
                { value: 'system', label: 'Follow system' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
