/**
 * Structure planner: deterministic page structures per direction (code decides structure, the LLM only
 * writes copy into it). For each direction several variants are enumerated, filtered by what the real
 * product data supports, and the variant LEAST similar to prior designs in the category (rejected designs
 * weighted heavier) and to this run's other designs is chosen. Learnings that shaped the structure are
 * recorded so the dashboard can show research → design.
 */
import type { ProductFacts } from '../catalogue/facts.js';
import type { Direction, VisualStrategy } from '../catalogue/page-config.js';
import { fingerprintOf, nearest, similarity, type Fingerprint } from './fingerprint.js';

export type PlannedSection =
  | { type: 'hero'; settings: Record<string, unknown> }
  | { type: 'purchase'; settings: Record<string, unknown>; claimIds: string[] }
  | { type: 'benefits'; settings: Record<string, unknown> }
  | { type: 'specs'; settings: Record<string, unknown>; maxRows: number }
  | { type: 'faq'; settings: Record<string, unknown> }
  | { type: 'gallery'; settings: Record<string, unknown> }
  | { type: 'comparison'; settings: Record<string, unknown> }
  | { type: 'reviews'; settings: Record<string, unknown>; maxReviews: number }
  | { type: 'trust'; settings: Record<string, unknown>; claimIds: string[] }
  | { type: 'offer'; settings: Record<string, unknown> }
  | { type: 'story'; settings: Record<string, unknown> };

export interface StructurePlan {
  direction: Direction;
  variantId: string;
  label: string; // human name of the structural idea, e.g. "Full-bleed story"
  visual: VisualStrategy;
  sections: PlannedSection[];
  appliedLearnings: { key: string; how: string }[];
  dataNotes: string[];
}

export interface LearningSignal { key: string; share: number; sample: number }
export interface HistoryItem { id: string; fp: Fingerprint; status: string; label?: string }

export interface PlannerInput {
  facts: ProductFacts;
  imageCount: number;
  learnings: LearningSignal[];
  history: HistoryItem[];
  brandSpacing?: 'compact' | 'balanced' | 'airy';
  seed: string;
  directions?: Direction[];
  /** variant ids to avoid (e.g. the design being regenerated) */
  excludeVariants?: string[];
}

const DENSITY = { compact: 'compact', balanced: 'balanced', airy: 'airy' } as const;

/** Deterministic PRNG from a string seed (mulberry32), for stable tie-breaks. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const share = (ls: LearningSignal[], key: string) => ls.find((l) => l.key === key)?.share ?? 0;

// ---------------------------------------------------------------------------------------------------------
function variantsFor(direction: Direction, inp: PlannerInput): StructurePlan[] {
  const f = inp.facts;
  const hasReviews = f.reviews.length > 0 || !!f.rating;
  const hasRating = !!f.rating;
  const hasSpecs = f.specs.length >= 2;
  const claimIds = f.claims.map((c) => c.id);
  const hasClaims = claimIds.length > 0;
  const hasOffer = !!f.offer || f.hasCompareAt;
  const manyImages = inp.imageCount >= 3;
  const ls = inp.learnings;
  const repeatCta = share(ls, 'repeated_atc') >= 0.5;
  const out: StructurePlan[] = [];
  const base = (id: string, label: string, visual: VisualStrategy, sections: PlannedSection[], applied: { key: string; how: string }[] = [], notes: string[] = []): StructurePlan => ({
    direction, variantId: `${direction}:${id}`, label, visual, sections, appliedLearnings: applied, dataNotes: notes,
  });
  const density = inp.brandSpacing ? DENSITY[inp.brandSpacing] : 'balanced';
  const faq = (style: string, align = 'left'): PlannedSection => ({ type: 'faq', settings: { style, align } });
  const specs = (layout: string): PlannedSection[] => (hasSpecs ? [{ type: 'specs', settings: { layout }, maxRows: 12 }] : []);
  const trust = (d: string): PlannedSection[] => (hasClaims ? [{ type: 'trust', settings: { density: d }, claimIds: claimIds.slice(0, 4) }] : []);
  const gallery = (layout: string, columns = '3'): PlannedSection[] => (manyImages ? [{ type: 'gallery', settings: { layout, columns, limit: 6 } }] : []);
  const reviews = (layout: string): PlannedSection[] => (hasReviews ? [{ type: 'reviews', settings: { layout }, maxReviews: 6 }] : []);
  const appliedCommon: { key: string; how: string }[] = [];
  if (share(ls, 'faq_section') >= 0.5) appliedCommon.push({ key: 'faq_section', how: 'FAQ included (most competitors answer questions on the page)' });
  if (share(ls, 'sticky_atc_mobile') > 0) appliedCommon.push({ key: 'sticky_atc_mobile', how: 'Sticky mobile add-to-cart included' });
  if (repeatCta) appliedCommon.push({ key: 'repeated_atc', how: 'Repeated scroll-to-buy CTA after the benefits' });
  const benefitsCta = repeatCta ? { cta_label: 'Add to cart' } : {};

  const benefitsGrid = (cols: string, card: string): PlannedSection => ({ type: 'benefits', settings: { layout: 'grid', columns: cols, card_style: card, align: 'center', ...benefitsCta } });
  const benefitsList = (): PlannedSection => ({ type: 'benefits', settings: { layout: 'list', card_style: 'plain', ...benefitsCta } });
  const comparison = (): PlannedSection => ({ type: 'comparison', settings: { align: 'left' } });
  const heroSec = (layout: string, media: 'left' | 'right', ratio: string): PlannedSection => ({ type: 'hero', settings: { layout: layout === 'collage' && !manyImages ? 'split' : layout, media_position: media, image_ratio: ratio, show_rating: hasRating } });
  const story = (layout: string, ratio: string): PlannedSection => ({ type: 'story', settings: { layout, image_ratio: ratio } });

  switch (direction) {
    case 'story-led': {
      const heroes = [['overlay', 'left', 'landscape'], ['stacked', 'left', 'landscape'], ['split', 'left', 'portrait'], ['collage', 'right', 'portrait']] as const;
      const orders: { id: string; label: string; body: () => PlannedSection[]; faq: PlannedSection }[] = [
        { id: 'story-first', label: 'story first', body: () => [story('alternate', 'landscape'), benefitsList(), ...gallery('mosaic')], faq: faq('split') },
        { id: 'benefits-first', label: 'benefits first', body: () => [benefitsList(), story('centered', 'portrait'), ...specs('stacked')], faq: faq('lines') },
        { id: 'gallery-led', label: 'gallery-led', body: () => [...gallery('strip'), story('alternate', 'square'), benefitsGrid('2', 'plain')], faq: faq('cards', 'center') },
      ];
      for (const [hero, media, ratio] of heroes)
        for (const o of orders)
          for (const color of ['warm', 'light'] as const) {
            if (hero === 'collage' && !manyImages) continue;
            out.push(base(`${hero}-${o.id}-${color}`, `${hero === 'overlay' ? 'Full-bleed' : hero === 'stacked' ? 'Centred' : hero === 'collage' ? 'Collage' : 'Split'} story, ${o.label}`,
              { colorStrategy: color, radius: hero === 'overlay' ? 'sharp' : 'soft', density: 'airy', accent: 'primary' },
              [heroSec(hero, media, ratio), ...o.body(), ...reviews('grid'), o.faq],
              [...appliedCommon, ...(share(ls, 'story_section') < 0.3 ? [{ key: 'story_section', how: 'Brand story used as a differentiator (few competitors tell one)' }] : [])]));
          }
      break;
    }
    case 'benefit-grid': {
      const heroes = [['split', 'left'], ['split', 'right'], ['collage', 'left']] as const;
      const orders: { id: string; label: string; body: (cols: string) => PlannedSection[]; color: VisualStrategy['colorStrategy'] }[] = [
        { id: 'specs-then-compare', label: 'specs then compare', body: (c) => [benefitsGrid(c, 'outline'), ...specs('split'), comparison(), ...trust('compact')], color: 'banded' },
        { id: 'compare-then-specs', label: 'compare then specs', body: (c) => [benefitsGrid(c, 'filled'), comparison(), ...specs('stacked'), ...trust('compact')], color: 'banded' },
        { id: 'trust-first', label: 'trust first', body: (c) => [...trust('compact'), benefitsGrid(c, 'filled'), ...specs('split'), comparison()], color: 'light' },
        { id: 'compare-led', label: 'comparison-led', body: (c) => [comparison(), benefitsGrid(c, 'plain'), ...specs('split'), ...trust('compact')], color: 'light' },
      ];
      for (const [hero, media] of heroes)
        for (const cols of ['3', '4'] as const)
          for (const o of orders) {
            if (hero === 'collage' && !manyImages) continue;
            const applied = [...appliedCommon];
            applied.push({ key: 'comparison_table', how: share(ls, 'comparison_table') < 0.4 ? 'Comparison table as a differentiator (rare among competitors)' : 'Comparison table (common among competitors)' });
            if (share(ls, 'specs_table') >= 0.3 && hasSpecs) applied.push({ key: 'specs_table', how: 'Specs table from real product data' });
            if (share(ls, 'benefit_icon_grid') > 0) applied.push({ key: 'benefit_icon_grid', how: 'Icon benefit grid' });
            out.push(base(`${hero}${media}-${cols}-${o.id}`, `Quick-scan grid (${cols} columns, ${o.label})`,
              { colorStrategy: o.color, radius: cols === '4' ? 'sharp' : 'soft', density: 'compact', accent: 'primary' },
              [heroSec(hero, media, 'square'), ...o.body(cols), faq(o.id === 'trust-first' ? 'cards' : 'lines')],
              applied, hasSpecs ? [] : ['No specs on the source page — specs section omitted.']));
          }
      break;
    }
    case 'social-proof': {
      const tops: { id: string; sec: () => PlannedSection }[] = [
        { id: 'purchase-strip', sec: () => ({ type: 'purchase', settings: { gallery_style: 'strip', show_rating: hasRating, description_source: 'custom' }, claimIds: claimIds.slice(0, 3) }) },
        { id: 'purchase-grid', sec: () => ({ type: 'purchase', settings: { gallery_style: 'grid', media_position: 'right', show_rating: hasRating, description_source: 'custom' }, claimIds: claimIds.slice(0, 3) }) },
        { id: 'purchase-stack', sec: () => ({ type: 'purchase', settings: { gallery_style: 'stack', show_rating: hasRating, description_source: 'custom' }, claimIds: claimIds.slice(0, 3) }) },
        { id: 'hero-collage', sec: () => heroSec('collage', 'right', 'portrait') },
      ];
      const orders: { id: string; body: () => PlannedSection[] }[] = hasReviews
        ? [
            { id: 'reviews-first', body: () => [...reviews('wall'), ...gallery('grid', '4'), benefitsGrid('3', 'filled')] },
            { id: 'gallery-reviews', body: () => [...gallery('strip'), ...reviews('grid'), benefitsGrid('3', 'plain'), ...trust('compact')] },
            { id: 'benefits-reviews', body: () => [benefitsList(), ...reviews('grid'), ...gallery('mosaic')] },
          ]
        : [
            { id: 'trust-first', body: () => [...trust('roomy'), benefitsGrid('3', 'filled'), ...specs('stacked'), ...gallery('grid', '4')] },
            { id: 'gallery-first', body: () => [...gallery('mosaic'), benefitsList(), ...trust('compact'), ...specs('split')] },
            { id: 'facts-first', body: () => [...specs('split'), ...trust('compact'), benefitsGrid('2', 'outline'), ...gallery('strip')] },
          ];
      for (const t of tops)
        for (const o of orders)
          for (const color of ['light', 'warm'] as const) {
            if (t.id === 'hero-collage' && !manyImages) continue;
            const applied = [...appliedCommon];
            if (hasRating && share(ls, 'rating_near_price') > 0) applied.push({ key: 'rating_near_price', how: 'Real rating shown next to the price' });
            if (share(ls, 'trust_near_atc') > 0 && hasClaims && t.id !== 'hero-collage') applied.push({ key: 'trust_near_atc', how: 'Verified trust points directly under add-to-cart' });
            out.push(base(`${t.id}-${o.id}-${color}`, hasReviews ? `Proof first (${o.id.replace(/-/g, ' ')})` : `Reassurance first (${o.id.replace(/-/g, ' ')}; no reviews available)`,
              { colorStrategy: color, radius: 'round', density: 'balanced', accent: 'secondary' },
              [t.sec(), ...o.body(), faq(o.id.endsWith('first') ? 'cards' : 'split', 'center')],
              applied, hasReviews ? [] : ['No genuine reviews or rating on the source page — reviews omitted; this direction leans on verified trust points and facts instead.']));
          }
      break;
    }
    case 'offer-led': {
      const heroes = [['stacked', 'right', 'landscape'], ['split', 'right', 'square'], ['overlay', 'right', 'landscape']] as const;
      const offerSec = (style: string): PlannedSection[] => (hasOffer ? [{ type: 'offer', settings: { style, show_savings: true, button_label: 'Shop the offer' } }] : []);
      const orders: { id: string; label: string; body: () => PlannedSection[] }[] = [
        { id: 'offer-top', label: 'offer up front', body: () => [...offerSec('bar'), ...trust('roomy'), benefitsGrid('3', 'plain'), ...specs('stacked')] },
        { id: 'value-compare', label: 'value vs alternative', body: () => [...offerSec('card'), comparison(), benefitsGrid('3', 'outline'), ...trust('compact')] },
        { id: 'benefits-then-offer', label: 'benefits then offer', body: () => [benefitsList(), ...offerSec('card'), ...trust('roomy'), ...specs('split')] },
      ];
      for (const [hero, media, ratio] of heroes)
        for (const o of orders)
          for (const color of ['contrast', 'banded'] as const) {
            const applied = [...appliedCommon];
            if (share(ls, 'compare_at_shown') > 0 && f.hasCompareAt) applied.push({ key: 'compare_at_shown', how: 'Struck-through compare-at price and savings badge from real prices' });
            if (share(ls, 'cod_mentioned') > 0 && claimIds.includes('cod')) applied.push({ key: 'cod_mentioned', how: 'COD shown near the offer (confirmed claim)' });
            out.push(base(`${hero}-${o.id}-${color}`, hasOffer ? `Offer-led (${o.label})` : `Value-led (${o.label}; no active offer)`,
              { colorStrategy: color, radius: 'brand', density, accent: 'secondary' },
              [heroSec(hero, media, ratio), ...o.body(), faq(o.id === 'value-compare' ? 'split' : 'lines')],
              applied, hasOffer ? [] : ['No offer or compare-at price — offer banner omitted; the page leads with value instead.']));
          }
      break;
    }
  }
  return out;
}

/** Skeleton config (placeholder copy) — only used to fingerprint a planned structure. */
export function skeletonConfig(p: StructurePlan) {
  return { designName: p.label, direction: p.direction, visual: p.visual, sections: p.sections as never } as Parameters<typeof fingerprintOf>[0];
}

export interface ChosenPlan extends StructurePlan {
  fingerprint: Fingerprint;
  nearestPrior: ReturnType<typeof nearest>;
  siblingMax: number;
  candidatesConsidered: number;
}

export function planDesigns(inp: PlannerInput): ChosenPlan[] {
  const rand = rng(inp.seed);
  const directions: Direction[] = inp.directions ?? ['story-led', 'benefit-grid', 'social-proof', 'offer-led'];
  const chosen: ChosenPlan[] = [];
  const priorItems = inp.history.map((h) => ({ id: h.id, label: h.label, fp: h.fp }));
  // Fingerprint every candidate of every direction up front so each choice can prefer variants that are
  // far from the OTHER directions' options too (distinctiveness), not just from earlier picks.
  const pool = new Map<Direction, { c: StructurePlan; fp: Fingerprint }[]>();
  for (const d of directions) pool.set(d, variantsFor(d, inp).filter((c) => !inp.excludeVariants?.includes(c.variantId)).map((c) => ({ c, fp: fingerprintOf(skeletonConfig(c)) })));
  for (const d of directions) {
    const others = directions.filter((x) => x !== d).flatMap((x) => pool.get(x)!.map((o) => o.fp));
    const scored = pool.get(d)!.map(({ c, fp }) => {
      const distinct = others.length ? others.reduce((s, o) => s + similarity(fp, o).score, 0) / others.length : 0;
      // prior designs in the category: rejected ones count 20% more, approved ones 10% less
      let priorMax = 0;
      for (const h of inp.history) {
        const s = similarity(fp, h.fp).score * (h.status === 'rejected' ? 1.2 : h.status === 'approved' ? 0.9 : 1);
        priorMax = Math.max(priorMax, s);
      }
      const siblingMax = Math.max(0, ...chosen.map((c2) => similarity(fp, c2.fingerprint).score));
      const score = Math.max(priorMax, siblingMax) + 0.3 * distinct + rand() * 0.01; // tiny jitter = stable tie-break per run
      return { c, fp, score, siblingMax };
    });
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];
    if (!best) continue;
    chosen.push({ ...best.c, fingerprint: best.fp, nearestPrior: nearest(best.fp, priorItems), siblingMax: Math.round(best.siblingMax * 1000) / 1000, candidatesConsidered: scored.length });
  }
  return chosen;
}
