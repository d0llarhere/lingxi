interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}

// Generic role="switch" toggle for Settings rows (auto-scroll, allow-online-
// voices, skip page numbers, fade out). Distinct from AudioPillMenu.tsx's
// own bespoke .pill-switch — different size/context, not worth unifying.
export function Switch({ checked, onChange, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`switch${checked ? ' switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}
