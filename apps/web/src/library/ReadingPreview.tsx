import type { HighlightMode } from '../settings/useReadingSettings';

interface ReadingPreviewProps {
  highlightMode: HighlightMode;
}

// Renders a fixed sample paragraph with the exact same classes the real
// reader uses (.reading-column/.reading-paragraph/.reading-sentence.is-
// active-sentence/.reading-word.is-active — see WordText.tsx/reader.css) so
// it updates live for free via the CSS cascade whenever useReadingSettings
// writes new custom properties — no extra wiring needed beyond passing the
// current highlight mode, which (like the real reader) is applied as a
// wrapper class rather than touched per-element.
export function ReadingPreview({ highlightMode }: ReadingPreviewProps) {
  const highlightClass =
    highlightMode === 'off' ? ' reading-highlight-off' : highlightMode === 'sentence' ? ' reading-highlight-sentence' : '';

  return (
    <div aria-label="Preview" className="reading-preview">
      <span className="settings-caption">Preview</span>
      <div className={`reading-column reading-preview-column${highlightClass}`}>
        <p className="reading-paragraph">
          The lantern swung on its chain like a slow clock.{' '}
          <span className="reading-sentence is-active-sentence">
            Somewhere near the back a <span className="reading-word is-active">page</span> turned,
          </span>{' '}
          though no one should have been there.
        </p>
      </div>
    </div>
  );
}
