import { describe, expect, it } from 'vitest';
import { demoFacts, fixtureFactsWithReviews } from '../fixtures/demo.js';
import { similarity } from './fingerprint.js';
import { planDesigns } from './planner.js';

const learnings = [
  { key: 'faq_section', share: 0.8, sample: 6 },
  { key: 'repeated_atc', share: 0.67, sample: 6 },
  { key: 'comparison_table', share: 0.1, sample: 6 },
  { key: 'sticky_atc_mobile', share: 0.5, sample: 6 },
];

describe('planDesigns', () => {
  const plans = planDesigns({ facts: demoFacts, imageCount: 5, learnings, history: [], seed: 'run-1' });

  it('plans one design per direction with clearly different structures', () => {
    expect(plans.map((p) => p.direction)).toEqual(['story-led', 'benefit-grid', 'social-proof', 'offer-led']);
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) expect(similarity(plans[i].fingerprint, plans[j].fingerprint).score).toBeLessThan(0.65);
  });
  it('only plans sections the real data supports', () => {
    const all = plans.flatMap((p) => p.sections.map((s) => s.type));
    expect(all).not.toContain('reviews'); // demo facts have no reviews
    const proof = plans.find((p) => p.direction === 'social-proof')!;
    expect(proof.dataNotes[0]).toMatch(/No genuine reviews/);
    const withReviews = planDesigns({ facts: fixtureFactsWithReviews, imageCount: 5, learnings, history: [], seed: 'r' });
    expect(withReviews.find((p) => p.direction === 'social-proof')!.sections.map((s) => s.type)).toContain('reviews');
  });
  it('records which competitor learnings shaped each design', () => {
    const grid = plans.find((p) => p.direction === 'benefit-grid')!;
    expect(grid.appliedLearnings.map((a) => a.key)).toEqual(expect.arrayContaining(['faq_section', 'repeated_atc', 'comparison_table']));
    expect(grid.appliedLearnings.find((a) => a.key === 'comparison_table')!.how).toMatch(/differentiator/);
  });
  it('is deterministic for the same seed', () => {
    const again = planDesigns({ facts: demoFacts, imageCount: 5, learnings, history: [], seed: 'run-1' });
    expect(again.map((p) => p.variantId)).toEqual(plans.map((p) => p.variantId));
  });
  it('a second run in the same category avoids the first run\'s structures', () => {
    const history = plans.map((p, i) => ({ id: `d${i}`, fp: p.fingerprint, status: 'draft' }));
    const second = planDesigns({ facts: demoFacts, imageCount: 5, learnings, history, seed: 'run-2' });
    for (const p of second) {
      expect(p.variantId).not.toBe(plans.find((x) => x.direction === p.direction)!.variantId);
      expect(p.nearestPrior!.score).toBeLessThan(0.9);
    }
  });
  it('steers away from rejected designs harder', () => {
    const rejected = [{ id: 'x', fp: plans[0].fingerprint, status: 'rejected' }];
    const next = planDesigns({ facts: demoFacts, imageCount: 5, learnings, history: rejected, seed: 'run-3', directions: ['story-led'] });
    expect(next[0].variantId).not.toBe(plans[0].variantId);
  });
});
