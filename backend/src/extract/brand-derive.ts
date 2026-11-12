/**
 * Pure interpretation of captured styles + screenshot palette into an editable BrandProfile with
 * per-field confidence. No I/O — unit tested with synthetic inputs.
 */
import type { BrandConfidence, BrandProfile } from '../catalogue/brand.js';
import { findFamily, fontHandle, FONT_LIBRARY } from '../catalogue/fonts.js';
import { contrast, hexToRgb, mix, readableOn, rgbToHex, type RGB } from '../render/color.js';
import type { ComputedBrandData } from './brand-capture.js';
import type { PaletteColor } from './palette.js';

// ---------- colour parsing ----------
export function cssColorToHex(css: string | null | undefined): string | null {
  if (!css) return null;
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (m) {
    let alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!Number.isFinite(alpha)) alpha = 1;
    if (alpha < 0.6) return null;
    return rgbToHex([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  const h = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) return rgbToHex(hexToRgb(css.trim()));
  return null;
}

function hsl([r, g, b]: RGB) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
export const saturation = (hex: string) => hsl(hexToRgb(hex)).s;
const lightness = (hex: string) => hsl(hexToRgb(hex)).l;
const isChromatic = (hex: string) => saturation(hex) > 0.22 && lightness(hex) > 0.08 && lightness(hex) < 0.92;
const dist = (a: string, b: string) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
};
const hueDist = (a: string, b: string) => {
  const d = Math.abs(hsl(hexToRgb(a)).h - hsl(hexToRgb(b)).h);
  return Math.min(d, 360 - d);
};

// ---------- fonts ----------
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'arial', 'helvetica', 'emoji', 'apple color emoji']);
const HINTS: [RegExp, string][] = [
  [/garamond|caslon|baskerville|times|georgia|minion|freight|tiempos|canela|ogg|domaine|didot|bodoni|serif display/i, 'Cormorant'],
  [/playfair|editorial|chronicle|recoleta|gt super/i, 'Playfair Display'],
  [/serif|lora|merriweather|crimson|libre/i, 'Lora'],
  [/futura|avenir|gotham|proxima|circular|gilroy|sofia|campton|montserrat|brandon|neue haas|graphik|gt walsheim|satoshi|general sans/i, 'Montserrat'],
  [/jost|urbanist|lexend|sora|red hat|plus jakarta|kumbh/i, 'Montserrat'],
  [/poppins|eina|cera|manrope|outfit|figtree|nunito/i, 'Poppins'],
  [/grotesk|grotesque|helvetica|arial|inter|sf pro|system|segoe|roboto|neue|aktiv|suisse|untitled sans/i, 'Inter'],
  [/mono|code|courier/i, 'Space Mono'],
  [/condensed|oswald|bebas|anton|league gothic|impact/i, 'Oswald'],
];

export function mapFont(fontFamilyCss: string, weight: number): BrandProfile['fonts']['heading'] & { confidence: number } {
  const families = fontFamilyCss.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const detected = families.find((f) => !GENERIC.has(f.toLowerCase())) ?? families[0] ?? 'sans-serif';
  // Self-hosted fonts often bake the weight into the family name (e.g. "__helveticaBold_1cd561")
  const nameWeight = /black|heavy/i.test(detected) ? 900 : /extra ?bold/i.test(detected) ? 800 : /semi ?bold|demi/i.test(detected) ? 600 : /bold/i.test(detected) ? 700 : /medium/i.test(detected) ? 500 : /light/i.test(detected) ? 300 : 0;
  if (nameWeight && weight <= 400) weight = nameWeight;
  const exact = findFamily(detected);
  if (exact) return { handle: fontHandle(exact, weight), detectedFamily: detected, matched: 'exact', confidence: 0.95 };
  const genericSerif = families.some((f) => f.toLowerCase() === 'serif');
  for (const [re, fam] of HINTS) {
    if (re.test(detected) || (genericSerif && fam === 'Lora' && !families.some((f) => /sans/i.test(f)))) {
      const def = FONT_LIBRARY.find((f) => f.family === fam)!;
      return { handle: fontHandle(def, weight), detectedFamily: detected, matched: 'closest', confidence: 0.55 };
    }
  }
  const fallback = FONT_LIBRARY.find((f) => f.family === (genericSerif ? 'Lora' : 'Assistant'))!;
  return { handle: fontHandle(fallback, weight), detectedFamily: detected, matched: 'default', confidence: 0.35 };
}

/** User-agent default colours (unstyled links etc.) — never evidence of a brand colour. */
const BROWSER_DEFAULTS = new Set(['#0000EE', '#551A8B', '#0000FF', '#EE0000', '#FF0000', '#1A0DAB', '#0645AD', '#0B0080']);

// ---------- main ----------
export function deriveBrandProfile(data: ComputedBrandData, palette: PaletteColor[]): { profile: Omit<BrandProfile, 'tone' | 'toneSummary' | 'imageStyle'>; confidence: BrandConfidence; notes: string[] } {
  const notes: string[] = [];
  const confidence: BrandConfidence = {};

  // background
  let background = cssColorToHex(data.body.bg) ?? cssColorToHex(data.htmlBg);
  const largestArea = data.bgAreas.map((a) => cssColorToHex(a.color)).find(Boolean) ?? null;
  if (background) confidence.background = { value: palette[0] && dist(palette[0].hex, background) < 30 ? 0.95 : 0.85, source: palette[0] && dist(palette[0].hex, background) < 30 ? 'css+screenshot' : 'css' };
  else if (palette[0] && palette[0].share > 0.5) {
    // the screenshot is the best evidence of what the visitor actually sees
    background = palette[0].hex;
    confidence.background = { value: 0.75, source: 'screenshot', note: `${Math.round(palette[0].share * 100)}% of the first screen` };
  } else if (largestArea) { background = largestArea; confidence.background = { value: 0.7, source: 'css', note: 'largest painted area' }; }
  else { background = palette[0]?.hex ?? '#FFFFFF'; confidence.background = { value: palette[0] ? 0.6 : 0.3, source: palette[0] ? 'screenshot' : 'default' }; }

  // text
  const bodyText = cssColorToHex(data.body.color);
  const mostText = data.textColors.map((t) => cssColorToHex(t.color)).find((c) => c && contrast(c, background!) >= 3) ?? null;
  let text = mostText ?? bodyText ?? readableOn(background, ['#111111']);
  confidence.text = { value: mostText ? 0.9 : bodyText ? 0.8 : 0.4, source: mostText || bodyText ? 'css' : 'default' };
  if (contrast(text, background) < 4.5) {
    notes.push(`Detected text colour ${text} has low contrast on ${background}; adjusted for readability.`);
    text = readableOn(background, [text]);
    confidence.text.value = Math.min(confidence.text.value, 0.6);
  }

  // button (prefer the add-to-cart button)
  const atc = data.atc;
  const atcBg = cssColorToHex(atc?.bg);
  const atcBorder = atc && atc.borderWidth >= 1 ? cssColorToHex(atc.borderColor) : null;
  let button: string;
  let buttonText: string;
  let style: BrandProfile['button']['style'] = 'solid';
  if (atc && atcBg && dist(atcBg, background) > 25) {
    button = atcBg;
    buttonText = cssColorToHex(atc.color) ?? readableOn(button, ['#FFFFFF']);
    confidence.button = { value: 0.9, source: 'css', note: `add-to-cart button "${atc.text}"` };
  } else if (atc && atcBorder) {
    button = atcBorder;
    buttonText = readableOn(button, ['#FFFFFF']);
    style = 'outline';
    confidence.button = { value: 0.7, source: 'css', note: 'outline add-to-cart button' };
  } else {
    const other = data.buttons.map((b) => cssColorToHex(b.bg)).find((c) => c && dist(c, background!) > 25);
    button = other ?? text;
    buttonText = readableOn(button, ['#FFFFFF']);
    confidence.button = { value: other ? 0.6 : 0.35, source: other ? 'css' : 'heuristic', note: other ? 'first solid button on the page' : 'no add-to-cart button found; using text colour' };
  }
  if (contrast(button, buttonText) < 4.5) buttonText = readableOn(button, [buttonText]);
  confidence.buttonText = { value: confidence.button.value, source: confidence.button.source };

  // primary / secondary: chromatic candidates weighted by evidence
  const cand = new Map<string, number>();
  const bump = (hex: string | null, w: number) => {
    if (!hex || !isChromatic(hex) || dist(hex, background!) < 40 || BROWSER_DEFAULTS.has(hex)) return;
    // merge near-duplicates
    const near = [...cand.keys()].find((k) => dist(k, hex) < 28);
    cand.set(near ?? hex, (cand.get(near ?? hex) ?? 0) + w);
  };
  bump(atcBg, 5);
  bump(cssColorToHex(data.headerBg), 2);
  data.linkColors.forEach((l) => bump(cssColorToHex(l.color), Math.min(2, l.count / 10)));
  data.buttons.forEach((b) => bump(cssColorToHex(b.bg), 1));
  const totalArea = data.bgAreas.reduce((s, a) => s + a.area, 0) || 1;
  data.bgAreas.forEach((a) => bump(cssColorToHex(a.color), (a.area / totalArea) * 6));
  data.textColors.forEach((t) => bump(cssColorToHex(t.color), Math.min(1.5, t.chars / 400)));
  palette.forEach((p) => bump(p.hex, p.share * 8));
  const ranked = [...cand.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);

  let primary: string;
  if (ranked[0]) {
    primary = ranked[0];
    const fromScreenshot = palette.some((p) => dist(p.hex, primary) < 30);
    confidence.primary = { value: fromScreenshot ? 0.8 : 0.7, source: fromScreenshot ? 'css+screenshot' : 'css' };
  } else {
    primary = dist(button, background) > 25 ? button : text;
    confidence.primary = { value: 0.5, source: 'heuristic', note: 'no distinct brand colour found (monochrome site); using button/text colour' };
  }
  let secondary = ranked.find((h) => h !== primary && (hueDist(h, primary) > 25 || Math.abs(lightness(h) - lightness(primary)) > 0.25));
  if (secondary) confidence.secondary = { value: 0.6, source: 'css+screenshot' };
  else {
    // No second brand colour: derive an on-brand companion instead of an unrelated neutral — a deep ink
    // version of the primary when the primary is light (e.g. yellow), otherwise a soft tint of it.
    secondary = lightness(primary) > 0.6 ? mix(primary, text, 0.82) : mix(background!, primary, 0.16);
    confidence.secondary = { value: 0.35, source: 'heuristic', note: 'no second brand colour found; derived from the primary' };
  }

  // fonts
  const headingSrc = data.h1 ?? data.h2 ?? data.body;
  const heading = mapFont(headingSrc.fontFamily, headingSrc.fontWeight);
  const body = mapFont(data.body.fontFamily, data.body.fontWeight || 400);
  confidence.headingFont = { value: heading.confidence * (data.h1 ? 1 : 0.8), source: 'css', note: `${heading.matched} match for "${heading.detectedFamily}"` };
  confidence.bodyFont = { value: body.confidence, source: 'css', note: `${body.matched} match for "${body.detectedFamily}"` };

  // button shape
  const radiusRaw = atc?.borderRadius ?? data.buttons[0]?.borderRadius ?? 4;
  const height = atc?.height ?? data.buttons[0]?.height ?? 44;
  if (radiusRaw >= height / 2 - 1 && radiusRaw > 8) style = style === 'outline' ? 'outline' : 'pill';
  const radiusPx = Math.min(32, Math.round(radiusRaw / 2) * 2);
  confidence.radius = { value: atc ? 0.9 : data.buttons.length ? 0.6 : 0.3, source: atc || data.buttons.length ? 'css' : 'default' };
  const tt = (atc?.textTransform ?? 'none') as string;
  const textTransform: BrandProfile['button']['textTransform'] = tt === 'uppercase' || tt === 'capitalize' ? tt : 'none';

  // spacing
  const pads = [...data.sectionPaddings].sort((a, b) => a - b);
  const median = pads.length ? pads[Math.floor(pads.length / 2)] : 0;
  const spacing: BrandProfile['spacing'] = !pads.length ? 'balanced' : median < 48 ? 'compact' : median < 110 ? 'balanced' : 'airy';
  confidence.spacing = { value: pads.length >= 3 ? 0.55 : 0.3, source: pads.length ? 'css' : 'default', note: pads.length ? `median section padding ${Math.round(median)}px` : undefined };

  return {
    profile: {
      colors: { primary, secondary, background: background!, text, button, buttonText },
      fonts: {
        heading: { handle: heading.handle, detectedFamily: heading.detectedFamily, matched: heading.matched },
        body: { handle: body.handle, detectedFamily: body.detectedFamily, matched: body.matched },
        headingSizePx: data.h1 ? Math.round(Math.min(120, Math.max(10, data.h1.fontSize))) : undefined,
        bodySizePx: Math.round(Math.min(30, Math.max(10, data.body.fontSize || 16))),
      },
      button: { radiusPx, style, textTransform },
      spacing,
    },
    confidence,
    notes,
  };
}
