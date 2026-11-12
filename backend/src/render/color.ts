// Small colour helpers used to derive accessible section palettes from brand colours.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Linear mix: t=0 -> a, t=1 -> b */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isDark = (hex: string) => luminance(hex) < 0.22;

/** First candidate that meets `min` contrast against bg; otherwise the best of black/white. */
export function readableOn(bg: string, candidates: string[], min = 4.5): string {
  for (const c of candidates) if (contrast(bg, c) >= min) return c.toUpperCase();
  return contrast(bg, '#111111') >= contrast(bg, '#FFFFFF') ? '#111111' : '#FFFFFF';
}

/** Push `color` towards `towards` until it reaches `min` contrast against bg (max 10 steps). */
export function ensureContrast(color: string, bg: string, min: number, towards?: string): string {
  const target = towards ?? (isDark(bg) ? '#FFFFFF' : '#000000');
  let c = color;
  for (let i = 0; i < 10 && contrast(c, bg) < min; i++) c = mix(c, target, 0.2);
  return c.toUpperCase();
}
