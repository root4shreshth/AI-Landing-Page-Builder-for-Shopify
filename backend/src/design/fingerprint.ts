/**
 * Layout fingerprints and an explainable weighted similarity (0 = nothing in common, 1 = identical under
 * this metric). This is a heuristic for "clearly different", not a guarantee of visual novelty.
 *
 * Weights (from the brief): section order 25%, hero layout 20%, section composition 20%,
 * visual style 15%, image arrangement 10%, ATC placement 10%.
 */
import type { PageConfigInput } from '../catalogue/page-config.js';

export interface Fingerprint {
  direction: string;
  heroType: string; // e.g. "hero:overlay", "purchase:strip"
  sectionOrder: string[]; // content sections in order (excl. seo/sticky)
  composition: string[]; // sorted unique section types
  visualStyle: string; // colorStrategy|radius|density|accent
  imageLayout: string; // hero image arrangement + gallery/story layout
  atcPlacement: string; // where the primary ATC is + repeated CTA
  colorStrategy: string;
}

export const WEIGHTS = { sectionOrder: 0.25, heroType: 0.2, composition: 0.2, visualStyle: 0.15, imageLayout: 0.1, atcPlacement: 0.1 } as const;
export type FeatureName = keyof typeof WEIGHTS;

export function fingerprintOf(cfg: PageConfigInput): Fingerprint {
  const sections = cfg.sections;
  const first = sections[0];
  const heroType =
    first?.type === 'hero' ? `hero:${(first.settings as { layout?: string }).layout ?? 'split'}` : first?.type === 'purchase' ? `purchase:${(first.settings as { gallery_style?: string }).gallery_style ?? 'grid'}` : `${first?.type ?? 'none'}`;
  const order = sections.map((s) => s.type);
  const gallery = sections.find((s) => s.type === 'gallery');
  const story = sections.find((s) => s.type === 'story');
  const heroImg =
    first?.type === 'hero'
      ? `${(first.settings as { layout?: string }).layout}/${(first.settings as { media_position?: string }).media_position ?? 'right'}/${(first.settings as { image_ratio?: string }).image_ratio ?? 'portrait'}`
      : first?.type === 'purchase'
        ? `gallery-${(first.settings as { gallery_style?: string }).gallery_style ?? 'grid'}/${(first.settings as { media_position?: string }).media_position ?? 'left'}`
        : 'none';
  const imageLayout = [heroImg, gallery ? `gallery:${(gallery.settings as { layout?: string }).layout ?? 'grid'}` : '', story ? `story:${(story.settings as { layout?: string }).layout ?? 'alternate'}` : ''].filter(Boolean).join('+');
  const repeated = sections.some((s) => (s.type === 'benefits' && (s.settings as { cta_label?: string }).cta_label) || (s.type === 'offer' && (s.settings as { button_label?: string }).button_label));
  const atcPlacement = `${first?.type === 'purchase' ? 'purchase-top' : 'hero-buybox'}${repeated ? '+repeat' : ''}+sticky`;
  const v = cfg.visual;
  return {
    direction: cfg.direction,
    heroType,
    sectionOrder: order,
    composition: [...new Set(order)].sort(),
    visualStyle: `${v.colorStrategy}|${v.radius ?? 'brand'}|${v.density ?? 'balanced'}|${v.accent ?? 'primary'}`,
    imageLayout,
    atcPlacement,
    colorStrategy: v.colorStrategy,
  };
}

/** Normalised similarity of two sequences via longest common subsequence (order-aware). */
export function sequenceSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2 * dp[a.length][b.length]) / (a.length + b.length);
}

export const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 1;
};

/** Partial credit for multi-part string features ("a|b|c|d"): share of equal parts. */
const parts = (a: string, b: string, sep: RegExp) => {
  const A = a.split(sep), B = b.split(sep);
  const n = Math.max(A.length, B.length);
  let eq = 0;
  for (let i = 0; i < n; i++) if (A[i] === B[i]) eq++;
  return n ? eq / n : 1;
};

export interface Similarity { score: number; features: Record<FeatureName, number> }

export function similarity(a: Fingerprint, b: Fingerprint): Similarity {
  const features: Record<FeatureName, number> = {
    sectionOrder: sequenceSimilarity(a.sectionOrder, b.sectionOrder),
    heroType: a.heroType === b.heroType ? 1 : a.heroType.split(':')[0] === b.heroType.split(':')[0] ? 0.4 : 0,
    composition: jaccard(a.composition, b.composition),
    visualStyle: parts(a.visualStyle, b.visualStyle, /\|/),
    imageLayout: jaccard(a.imageLayout.split('+'), b.imageLayout.split('+')),
    atcPlacement: parts(a.atcPlacement, b.atcPlacement, /\+/),
  };
  const score = (Object.keys(WEIGHTS) as FeatureName[]).reduce((s, k) => s + WEIGHTS[k] * features[k], 0);
  return { score: Math.round(score * 1000) / 1000, features: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) as Record<FeatureName, number> };
}

export interface NearestMatch extends Similarity { id: string; label?: string }

export function nearest(fp: Fingerprint, others: { id: string; label?: string; fp: Fingerprint }[]): NearestMatch | null {
  let best: NearestMatch | null = null;
  for (const o of others) {
    const s = similarity(fp, o.fp);
    if (!best || s.score > best.score) best = { id: o.id, label: o.label, ...s };
  }
  return best;
}

/** Plain-language explanation of what is shared with the nearest design (for the dashboard). */
export function explain(sim: Similarity): string[] {
  const names: Record<FeatureName, string> = { sectionOrder: 'section order', heroType: 'hero layout', composition: 'sections used', visualStyle: 'visual style', imageLayout: 'image arrangement', atcPlacement: 'add-to-cart placement' };
  return (Object.keys(WEIGHTS) as FeatureName[])
    .sort((x, y) => WEIGHTS[y] * sim.features[y] - WEIGHTS[x] * sim.features[x])
    .map((k) => `${names[k]}: ${Math.round(sim.features[k] * 100)}% similar (weight ${Math.round(WEIGHTS[k] * 100)}%)`);
}
