import { describe, expect, it } from 'vitest';
import { demoConfigs } from '../fixtures/demo.js';
import { explain, fingerprintOf, jaccard, nearest, sequenceSimilarity, similarity, WEIGHTS } from './fingerprint.js';

describe('fingerprint similarity', () => {
  const fps = demoConfigs.map(fingerprintOf);
  it('weights sum to 1', () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1));
  it('identical designs score 1, and similarity is symmetric', () => {
    expect(similarity(fps[0], fps[0]).score).toBe(1);
    expect(similarity(fps[0], fps[1]).score).toBe(similarity(fps[1], fps[0]).score);
  });
  it('the four demo directions are clearly different from each other (< 0.6)', () => {
    for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) expect(similarity(fps[i], fps[j]).score, `${i} vs ${j}`).toBeLessThan(0.6);
  });
  it('captures hero, order and style in the fingerprint', () => {
    expect(fps[0]).toMatchObject({ heroType: 'hero:overlay', direction: 'story-led', colorStrategy: 'warm' });
    expect(fps[2].heroType).toBe('purchase:strip');
    expect(fps[2].atcPlacement).toBe('purchase-top+sticky');
  });
  it('sequence similarity is order-aware; jaccard ignores order', () => {
    expect(sequenceSimilarity(['a', 'b', 'c'], ['c', 'b', 'a'])).toBeLessThan(0.5);
    expect(jaccard(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(1);
  });
  it('finds the nearest prior design and explains shared features', () => {
    const shuffled = { ...demoConfigs[0], visual: { ...demoConfigs[0].visual, density: 'compact' as const } };
    const n = nearest(fingerprintOf(shuffled), fps.map((fp, i) => ({ id: `d${i}`, fp })))!;
    expect(n.id).toBe('d0');
    expect(n.score).toBeGreaterThan(0.9);
    expect(explain(n)[0]).toMatch(/section order: 100% similar \(weight 25%\)/);
    expect(nearest(fps[0], [])).toBeNull();
  });
});
