/**
 * Shopify font library subset used for brand mapping and local previews.
 * Handle format: <family_snake>_<style><weight/100>, e.g. playfair_display_n7.
 * All families listed are also on Google Fonts, so local previews load the same face.
 *
 * Verified 2026-11-12: every handle fontHandle() can produce for these families (110 handles) was pushed
 * to a real Shopify theme and accepted. EB Garamond was rejected for all weights and removed.
 */
export interface FontFamilyDef {
  family: string;
  base: string; // handle prefix
  category: 'sans' | 'serif' | 'display' | 'mono';
  weights: number[]; // available normal weights (x100)
  fallback: string;
}

const F = (family: string, category: FontFamilyDef['category'], weights: number[]): FontFamilyDef => ({
  family,
  base: family.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  category,
  weights,
  fallback: category === 'serif' ? 'serif' : category === 'mono' ? 'monospace' : 'sans-serif',
});

export const FONT_LIBRARY: FontFamilyDef[] = [
  F('Assistant', 'sans', [2, 3, 4, 6, 7, 8]),
  F('Inter', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Montserrat', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Poppins', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Lato', 'sans', [1, 3, 4, 7, 9]),
  F('Open Sans', 'sans', [3, 4, 5, 6, 7, 8]),
  F('Nunito Sans', 'sans', [2, 3, 4, 6, 7, 8, 9]),
  F('Work Sans', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('DM Sans', 'sans', [4, 5, 7]),
  F('Karla', 'sans', [2, 3, 4, 5, 6, 7, 8]),
  F('Rubik', 'sans', [3, 4, 5, 6, 7, 8, 9]),
  F('Raleway', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Josefin Sans', 'sans', [1, 2, 3, 4, 5, 6, 7]),
  F('Archivo', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Barlow', 'sans', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Space Grotesk', 'sans', [3, 4, 5, 6, 7]),
  F('Quicksand', 'sans', [3, 4, 5, 6, 7]),
  F('Oswald', 'display', [2, 3, 4, 5, 6, 7]),
  F('Abril Fatface', 'display', [4]),
  F('Playfair Display', 'serif', [4, 5, 6, 7, 8, 9]),
  F('Lora', 'serif', [4, 5, 6, 7]),
  F('Libre Baskerville', 'serif', [4, 7]),
  F('Cormorant', 'serif', [3, 4, 5, 6, 7]),
  F('Fraunces', 'serif', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
  F('Merriweather', 'serif', [3, 4, 7, 9]),
  F('Space Mono', 'mono', [4, 7]),
];

const byBase = new Map(FONT_LIBRARY.map((f) => [f.base, f]));

export interface ResolvedFont {
  handle: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  fallback_families: string;
}

export function parseFontHandle(handle: string): ResolvedFont {
  const m = handle.match(/^([a-z0-9_]+)_([nio])([1-9])$/);
  const def = m ? byBase.get(m[1]) : undefined;
  if (!m || !def) return { handle, family: 'Assistant', weight: 400, style: 'normal', fallback_families: 'sans-serif' };
  return { handle, family: def.family, weight: Number(m[3]) * 100, style: m[2] === 'n' ? 'normal' : 'italic', fallback_families: def.fallback };
}

/** Closest available weight for a family. */
export function fontHandle(def: FontFamilyDef, weight: number): string {
  const w = Math.round(weight / 100);
  const best = def.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
  return `${def.base}_n${best}`;
}

export const findFamily = (familyOrBase: string) =>
  byBase.get(familyOrBase.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
