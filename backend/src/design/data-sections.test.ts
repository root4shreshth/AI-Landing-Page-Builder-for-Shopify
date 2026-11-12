import { describe, expect, it } from 'vitest';
import { demoFacts } from '../fixtures/demo.js';
import { factItems, hasFactStrip, hasMarquee, marqueeItems, titleFacts } from './data-sections.js';

describe('data-only sections', () => {
  it('reads measured values from the product title', () => {
    expect(titleFacts('M8 Competition Fan Art - Black - Oversized Hoodie 400 GSM')).toEqual([{ value: '400 GSM', label: 'Fabric weight' }]);
    expect(titleFacts('Steel Bottle 750 ml')).toEqual([{ value: '750 ml', label: 'Capacity' }]);
    expect(titleFacts('Plain tee')).toEqual([]);
  });
  it('builds the fact strip from short specs, numbers first, no duplicates', () => {
    const items = factItems(demoFacts);
    expect(items[0]).toEqual({ value: '180 GSM', label: 'Fabric weight' });
    expect(items.length).toBeLessThanOrEqual(4);
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
    expect(hasFactStrip(demoFacts)).toBe(true);
  });
  it('builds the brand band only from verified promises and facts', () => {
    const sparse = { ...demoFacts, specs: [], highlights: [], title: 'Oversized Hoodie 400 GSM', claims: [{ id: 'free_shipping', icon: 'truck' as const, title: 'Free shipping', source: 'x' }, { id: 'secure_checkout', icon: 'lock' as const, title: 'Secure checkout', source: 'x' }] };
    expect(marqueeItems(sparse)).toEqual(['Free shipping', 'Secure checkout', '400 GSM']);
    expect(hasMarquee(sparse)).toBe(true);
    expect(hasMarquee({ ...sparse, claims: [] })).toBe(false);
  });
});
