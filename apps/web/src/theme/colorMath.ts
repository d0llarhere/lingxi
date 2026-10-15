// Small hex/HSL/contrast utilities for the Appearance settings' accent
// color system (useAccentColor.ts). Pure functions, no DOM access — not
// worth a dedicated test harness for (apps/web has none today), but each
// function is short enough to read correctness directly from.

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: RGB): number {
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

// WCAG contrast ratio, 1–21.
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// Darkens a color (same hue/saturation, reduced HSL lightness) in small
// steps until it reaches at least `minContrast` against `against` — the
// light theme's accent, derived from the dark theme's pale swatch hex
// (chosen to reproduce today's hand-picked Jade pair — #7cc4a8 dark /
// #3f8268 light — as a sanity check).
export function darkenForContrast(hex: string, against: string, minContrast: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  let candidate = hex;
  for (let l = hsl.l; l > 0.05; l -= 0.02) {
    if (contrastRatio(candidate, against) >= minContrast) break;
    candidate = rgbToHex(hslToRgb({ ...hsl, l }));
  }
  return candidate;
}

// Shifts lightness by a fixed delta (negative = darker), same hue/
// saturation — used for a hover variant one step off the base accent.
export function shiftLightness(hex: string, delta: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  const l = Math.max(0, Math.min(1, hsl.l + delta));
  return rgbToHex(hslToRgb({ ...hsl, l }));
}

// Whichever of two candidate text colors has higher contrast against hex —
// for --on-accent/--accent-contrast (text/icons painted directly on the
// accent background).
export function pickOnColor(hex: string, lightOption = '#ffffff', darkOption = '#11241c'): string {
  return contrastRatio(hex, lightOption) >= contrastRatio(hex, darkOption) ? lightOption : darkOption;
}
