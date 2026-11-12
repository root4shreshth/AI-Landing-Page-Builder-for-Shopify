import { describe, expect, it } from 'vitest';
import { isUnbackedPolicyQuestion } from './facts.js';

describe('store-policy questions', () => {
  it('needs a matching confirmed promise', () => {
    expect(isUnbackedPolicyQuestion('Does shipping cost extra?', new Set())).toBe(true);
    expect(isUnbackedPolicyQuestion('Does shipping cost extra?', new Set(['free_shipping']))).toBe(false);
    expect(isUnbackedPolicyQuestion('When will it be delivered?', new Set(['delivery_time']))).toBe(false);
    expect(isUnbackedPolicyQuestion('Is cash on delivery available?', new Set(['delivery_time']))).toBe(true);
    expect(isUnbackedPolicyQuestion('Can I return it?', new Set(['returns']))).toBe(false);
  });
  it('leaves product questions alone', () => {
    expect(isUnbackedPolicyQuestion('How does the hoodie fit?', new Set())).toBe(false);
    expect(isUnbackedPolicyQuestion('What is the coding on the label?', new Set())).toBe(false);
  });
});
