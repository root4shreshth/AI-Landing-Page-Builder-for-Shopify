import type { BrandTokens } from '../catalogue/brand.js';
import type { SectionType, VisualStrategy } from '../catalogue/page-config.js';
import { contrast, ensureContrast, isDark, mix, readableOn } from './color.js';

export type RenderedType = SectionType | 'seo' | 'sticky';

export interface StyleSettings {
  lp_bg: string;
  lp_fg: string;
  lp_accent: string;
  lp_btn_bg: string;
  lp_btn_fg: string;
  lp_heading_font: string;
  lp_body_font: string;
  lp_radius: number;
  lp_width?: 'narrow' | 'normal' | 'wide' | 'full';
  lp_pt?: number;
  lp_pb?: number;
}

const RADIUS: Record<Exclude<VisualStrategy['radius'], 'brand'>, number> = { sharp: 0, soft: 8, round: 20 };
const PAD: Record<VisualStrategy['density'], number> = { airy: 96, balanced: 64, compact: 40 };
const round4 = (n: number) => Math.max(0, Math.min(120, Math.round(n / 4) * 4));

/**
 * Deterministic per-section palette + spacing. Guarantees WCAG AA text contrast (4.5:1) and
 * >= 3:1 for accents/buttons against each section background.
 */
export function styleFor(
  type: RenderedType,
  contentIndex: number,
  brand: BrandTokens,
  visual: VisualStrategy,
): StyleSettings {
  const c = brand.colors;
  const base = c.background;
  const accentSrc = visual.accent === 'secondary' ? c.secondary : c.primary;

  // ---- background per strategy ----
  let bg = base;
  const band = contentIndex % 2 === 1;
  switch (visual.colorStrategy) {
    case 'banded':
      if (band && type !== 'sticky' && type !== 'seo') bg = mix(base, c.primary, isDark(base) ? 0.14 : 0.07);
      if (type === 'trust' || type === 'offer') bg = mix(base, accentSrc, 0.12);
      break;
    case 'contrast': {
      const strong = isDark(c.primary) ? c.primary : c.text;
      if (type === 'hero' || type === 'offer' || (type === 'faq' && band)) bg = strong;
      else if (type === 'trust') bg = mix(base, accentSrc, 0.1);
      break;
    }
    case 'warm':
      if (type === 'hero' || band) bg = mix(base, c.secondary, isDark(base) ? 0.18 : 0.14);
      if (type === 'offer') bg = mix(base, c.secondary, 0.28);
      break;
    case 'light':
    default:
      if (type === 'trust' || type === 'offer') bg = mix(base, accentSrc, 0.07);
  }
  if (type === 'sticky' || type === 'seo') bg = base;
  // The brand band is the page's boldest brand moment: the signature colour (or ink if it is too close to the background)
  if (type === 'marquee') bg = contrast(c.primary, base) >= 1.08 ? c.primary : c.text;
  if (type === 'facts' && visual.colorStrategy === 'contrast') bg = isDark(c.primary) ? c.primary : c.text;

  const fg = readableOn(bg, [c.text, isDark(bg) ? '#FFFFFF' : '#111111']);
  const accent = ensureContrast(accentSrc, bg, 4.5); // accents are also used for small text (eyebrows), so AA for text

  let btnBg = c.button;
  if (contrast(btnBg, bg) < 3) btnBg = contrast(accentSrc, bg) >= 3 ? accentSrc : fg;
  const btnFg = readableOn(btnBg, [c.buttonText, '#FFFFFF', '#111111']);

  const radius = visual.radius === 'brand' ? brand.radiusPx : RADIUS[visual.radius];

  const style: StyleSettings = {
    lp_bg: bg.toUpperCase(),
    lp_fg: fg,
    lp_accent: accent,
    lp_btn_bg: btnBg.toUpperCase(),
    lp_btn_fg: btnFg,
    lp_heading_font: brand.fonts.heading,
    lp_body_font: brand.fonts.body,
    lp_radius: Math.round(Math.min(32, radius) / 2) * 2,
  };
  if (type === 'sticky' || type === 'marquee') return style; // these schemas have no width/padding settings

  const pad = PAD[visual.density];
  const width: StyleSettings['lp_width'] =
    type === 'faq' || type === 'specs' ? 'narrow' : 'normal'; // gallery shares the page grid so headings align
  let pt = pad;
  let pb = pad;
  if (type === 'seo') { pt = 12; pb = 0; }
  else if (type === 'trust') { pt = pb = Math.min(pad, 32); }
  else if (type === 'offer') { pt = pb = Math.min(pad, 40); }
  else if (type === 'hero') { pt = Math.max(24, pad * 0.6); pb = pad; }
  else if (type === 'purchase') { pt = Math.max(24, pad * 0.6); }
  return { ...style, lp_width: width, lp_pt: round4(pt), lp_pb: round4(pb) };
}
