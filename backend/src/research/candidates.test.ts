import { describe, expect, it } from 'vitest';
import { demoFacts } from '../fixtures/demo.js';
import { buildQueries, keywordsFor, pageTypeOf, registrableDomain, scoreResult } from './candidates.js';

describe('candidate selection helpers', () => {
  it('extracts product keywords without brand, stop words or numbers', () => {
    const kw = keywordsFor({ ...demoFacts, title: 'Demo Brand Organic Cotton Crew T-Shirt (Pack of 2)', brandName: 'Demo Brand' });
    expect(kw).toEqual(expect.arrayContaining(['organic', 'cotton', 'crew']));
    expect(kw).not.toContain('demo');
    expect(kw).not.toContain('pack');
  });
  it('builds India-focused queries', () => {
    const q = buildQueries(demoFacts);
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q.every((x) => /india/.test(x))).toBe(true);
  });
  it('normalises registrable domains', () => {
    expect(registrableDomain('www.shop.example.co.in')).toBe('example.co.in');
    expect(registrableDomain('store.brand.com')).toBe('brand.com');
  });
  it('classifies page types', () => {
    expect(pageTypeOf(new URL('https://a.in/products/tee'))).toBe('product');
    expect(pageTypeOf(new URL('https://a.in/collections/tees'))).toBe('collection');
    expect(pageTypeOf(new URL('https://a.in/'))).toBe('home');
  });
  it('scores relevance with a readable rationale and Indian signal', () => {
    const s = scoreResult({ title: 'Organic Cotton Tee – ₹799', url: 'https://tees.in/products/organic-cotton-tee', snippet: 'Made in India', position: 2, query: 'organic cotton tee india', provider: 'serper' }, ['organic', 'cotton', 'crew']);
    expect(s.isIndian).toBe(true);
    expect(s.relevance).toBeGreaterThan(0.6);
    expect(s.reasons.join(' ')).toMatch(/ranked #2.*"organic", "cotton".*product page.*Indian D2C/);
    const weak = scoreResult({ title: 'Shoes', url: 'https://shoes.com/blog/x', snippet: '', position: 19, query: 'q', provider: 'serper' }, ['organic', 'cotton']);
    expect(weak.relevance).toBeLessThan(0.15);
  });
});
