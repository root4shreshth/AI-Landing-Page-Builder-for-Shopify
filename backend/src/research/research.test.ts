import { describe, expect, it } from 'vitest';
import { deriveFeatures } from './features.js';
import { computeLearnings } from './learnings.js';
import type { PageSignals } from './page-signals.js';

const sig = (o: Partial<PageSignals> = {}): PageSignals => ({
  viewport: { w: 390, h: 844 },
  h1: { words: 4, hasNumber: false, isQuestion: false, matchesTitle: true },
  sections: [
    { index: 0, top: 0, height: 900, kind: 'purchase' },
    { index: 1, top: 900, height: 500, kind: 'benefits' },
    { index: 2, top: 1400, height: 600, kind: 'reviews' },
    { index: 3, top: 2000, height: 300, kind: 'content' },
    { index: 4, top: 2300, height: 400, kind: 'faq' },
  ],
  atc: { count: 2, firstTop: 600, aboveFold: true },
  price: { top: 400, hasCompare: true, discountBadge: true, emi: false },
  rating: { present: true, top: 380, nearPrice: true },
  faq: { present: true, questions: 5 },
  comparisonTable: false, specsTable: true, video: false, ugc: false, urgency: false, bundle: false, cod: true, delivery: true, returns: true,
  trustNearAtc: 3, imageCount: 6, sizeGuide: false, iconGrid: true, pageHeight: 4000,
  ...o,
});

describe('deriveFeatures', () => {
  it('maps signals to features with neutral evidence and a clean section order', () => {
    const f = deriveFeatures(sig(), true);
    expect(f.sectionOrder).toEqual(['purchase', 'benefits', 'reviews', 'faq']);
    expect(f.atcPlacement).toBe('first-screen');
    expect(f.headlineStyle).toBe('product-name');
    expect(f.features.rating_near_price).toEqual({ value: true, evidence: 'rating within ~250px of the price' });
    expect(f.features.sticky_atc_mobile.value).toBe(true);
    expect(f.features.trust_near_atc.value).toBe(true);
  });
  it('handles pages without an add-to-cart or h1', () => {
    const f = deriveFeatures(sig({ atc: { count: 0, firstTop: null, aboveFold: false }, h1: null }), false);
    expect(f.atcPlacement).toBe('none');
    expect(f.headlineStyle).toBe('none');
    expect(f.features.atc_above_fold_mobile.evidence).toBe('no add-to-cart found');
  });
});

describe('computeLearnings', () => {
  const items = [
    { id: 'a', url: 'https://a.in/p', domain: 'a.in', features: deriveFeatures(sig(), true) },
    { id: 'b', url: 'https://b.in/p', domain: 'b.in', features: deriveFeatures(sig({ rating: { present: false, top: null, nearPrice: false } }), false) },
    { id: 'c', url: 'https://c.in/p', domain: 'c.in', features: deriveFeatures(sig({ sections: [{ index: 0, top: 0, height: 900, kind: 'purchase' }, { index: 1, top: 900, height: 300, kind: 'gallery' }, { index: 2, top: 1200, height: 300, kind: 'offer' }, { index: 3, top: 1500, height: 300, kind: 'gallery' }] }), true) },
  ];
  const ls = computeLearnings(items);
  it('counts supporting pages and links each to its sources', () => {
    const r = ls.find((l) => l.key === 'rating_near_price')!;
    expect(r.observation).toBe('2 of 3 pages: rating/reviews shown right next to the price');
    expect(r.sources.map((s) => s.domain)).toEqual(['a.in', 'c.in']);
    expect(r.kind).toBe('common');
    expect(r.hypothesis).toMatch(/^Hypothesis \(not proven\)/);
  });
  it('keeps acronyms and counts pages, not section occurrences', () => {
    expect(ls.find((l) => l.key === 'faq_section')!.observation).toContain('FAQ section');
    const reviews = ls.find((l) => l.key === 'section_reviews')!;
    expect(reviews.supportCount).toBe(2);
    expect(reviews.sources.length).toBe(2);
  });
  it('is sorted by prevalence and empty for no data', () => {
    expect(ls[0].share).toBeGreaterThanOrEqual(ls[ls.length - 1].share);
    expect(computeLearnings([])).toEqual([]);
  });
});
