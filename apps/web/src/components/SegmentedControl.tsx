import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string | number> {
  ariaLabel: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

// Generic role="radiogroup" segmented control — reused across every
// Reading/Listening/Appearance settings row that's a small fixed choice
// (line spacing, text width, font, speed, skip-by, reduce motion, …), same
// arrow-key-navigation pattern SettingsScreen.tsx's Chapters radiogroup
// already uses.
export function SegmentedControl<T extends string | number>({ ariaLabel, options, value, onChange }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!forward && !backward) return;
    e.preventDefault();
    const nextIndex = forward ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
    const next = options[nextIndex]!;
    onChange(next.value);
    refs.current[nextIndex]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="seg-control">
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={`seg-btn${option.value === value ? ' seg-btn-on' : ''}`}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
