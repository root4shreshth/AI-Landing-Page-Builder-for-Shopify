import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { BrandProfileSchema } from '../catalogue/brand.js';
import { contrast } from '../render/color.js';
import type { ComputedBrandData } from './brand-capture.js';
import { cssColorToHex, deriveBrandProfile, mapFont } from './brand-derive.js';
import { kmeans, screenshotPalette } from './palette.js';

const style = (o: Partial<ComputedBrandData['body']> = {}) => ({ bg: 'rgba(0, 0, 0, 0)', color: 'rgb(18, 18, 18)', fontFamily: 'Assistant, sans-serif', fontSize: 16, fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', ...o });
const base = (o: Partial<ComputedBrandData> = {}): ComputedBrandData => ({
  body: style({ bg: 'rgb(255, 255, 255)' }),
  htmlBg: 'rgba(0, 0, 0, 0)',
  h1: style({ fontFamily: '"Playfair Display", serif', fontWeight: 700, fontSize: 44 }),
  h2: null,
  atc: { ...style({ bg: 'rgb(23, 50, 77)', color: 'rgb(255, 255, 255)', textTransform: 'uppercase' }), borderRadius: 24, borderColor: 'rgb(23, 50, 77)', borderWidth: 1, height: 48, text: 'Add to cart' },
  buttons: [],
  linkColors: [{ color: 'rgb(18, 18, 18)', count: 40 }],
  headerBg: 'rgb(255, 255, 255)',
  bgAreas: [{ color: 'rgb(255, 255, 255)', area: 1_000_000 }, { color: 'rgb(233, 183, 107)', area: 120_000 }],
  textColors: [{ color: 'rgb(18, 18, 18)', chars: 3000 }],
  sectionPaddings: [64, 72, 80],
  headingTexts: [],
  ctaTexts: [],
  ...o,
});

describe('cssColorToHex', () => {
  it('parses rgb/rgba/hex and ignores transparent', () => {
    expect(cssColorToHex('rgb(23, 50, 77)')).toBe('#17324D');
    expect(cssColorToHex('rgba(255, 255, 255, 0.95)')).toBe('#FFFFFF');
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('rgb(10 20 30 / 50%)')).toBeNull();
    expect(cssColorToHex('#abc')).toBe('#AABBCC');
    expect(cssColorToHex('transparent')).toBeNull();
  });
});

describe('mapFont', () => {
  it('exact matches Shopify library families with nearest weight', () => {
    expect(mapFont('"Playfair Display", serif', 700)).toMatchObject({ handle: 'playfair_display_n7', matched: 'exact' });
    expect(mapFont('Poppins, sans-serif', 550)).toMatchObject({ handle: 'poppins_n6', matched: 'exact' });
  });
  it('maps proprietary fonts to the closest available family', () => {
    expect(mapFont('"Futura PT", sans-serif', 500)).toMatchObject({ handle: 'montserrat_n5', matched: 'closest', detectedFamily: 'Futura PT' });
    expect(mapFont('"Canela Deck", Georgia, serif', 400)).toMatchObject({ handle: 'cormorant_n4', matched: 'closest' });
  });
  it('reads weight hints baked into self-hosted font names', () => {
    expect(mapFont('__helveticaBold_1cd561, __helveticaBold_Fallback', 400)).toMatchObject({ handle: 'inter_n7', matched: 'closest' });
  });
  it('falls back by generic family', () => {
    expect(mapFont('"Totally Custom", serif', 400)).toMatchObject({ handle: 'lora_n4' });
    expect(mapFont('"Totally Custom"', 400)).toMatchObject({ handle: 'assistant_n4', matched: 'default' });
  });
});

describe('deriveBrandProfile', () => {
  it('reads background, text, ATC button, chromatic primary/secondary, fonts and pill shape', () => {
    const { profile, confidence } = deriveBrandProfile(base(), []);
    expect(profile.colors).toMatchObject({ background: '#FFFFFF', text: '#121212', button: '#17324D', buttonText: '#FFFFFF', primary: '#17324D', secondary: '#E9B76B' });
    expect(profile.fonts.heading.handle).toBe('playfair_display_n7');
    expect(profile.fonts.body.handle).toBe('assistant_n4');
    expect(profile.button).toEqual({ radiusPx: 24, style: 'pill', textTransform: 'uppercase' });
    expect(profile.spacing).toBe('balanced');
    expect(confidence.button.value).toBeGreaterThan(0.8);
    // must satisfy the editable schema (with LLM fields defaulted)
    expect(() => BrandProfileSchema.parse({ ...profile, tone: [], toneSummary: '', imageStyle: 'unknown' })).not.toThrow();
  });
  it('handles monochrome sites and outline buttons honestly (lower confidence)', () => {
    const { profile, confidence } = deriveBrandProfile(base({ atc: { ...base().atc!, bg: 'rgba(0, 0, 0, 0)', borderColor: 'rgb(0, 0, 0)', borderRadius: 0, color: 'rgb(0,0,0)' }, bgAreas: [{ color: 'rgb(255, 255, 255)', area: 1 }] }), []);
    expect(profile.button.style).toBe('outline');
    expect(profile.colors.button).toBe('#000000');
    expect(confidence.primary.value).toBeLessThanOrEqual(0.5);
    expect(confidence.secondary.source).toBe('default');
  });
  it('fixes unreadable text/button combinations', () => {
    const { profile, notes } = deriveBrandProfile(base({ textColors: [{ color: 'rgb(240, 240, 240)', chars: 100 }], body: style({ bg: 'rgb(255,255,255)', color: 'rgb(245,245,245)' }) }), []);
    expect(contrast(profile.colors.text, profile.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(notes.length).toBe(1);
    expect(contrast(profile.colors.button, profile.colors.buttonText)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('screenshot palette', () => {
  it('finds dominant colours and their shares deterministically', () => {
    const png = new PNG({ width: 100, height: 100 });
    for (let i = 0; i < 100 * 100; i++) {
      const isAccent = i % 100 < 20; // 20% columns
      png.data.set(isAccent ? [233, 183, 107, 255] : [255, 255, 255, 255], i * 4);
    }
    const buf = PNG.sync.write(png);
    const p1 = screenshotPalette(buf);
    expect(p1[0]).toMatchObject({ hex: '#FFFFFF' });
    expect(p1[0].share).toBeCloseTo(0.8, 1);
    expect(p1[1].hex).toBe('#E9B76B');
    expect(screenshotPalette(buf)).toEqual(p1);
  });
  it('returns empty for no pixels', () => expect(kmeans([])).toEqual([]));
});
