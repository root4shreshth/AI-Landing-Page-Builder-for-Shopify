import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ICONS } from '../catalogue/icons.js';
import { demoBrand, demoConfigs, demoFacts, fixtureFactsWithReviews } from '../fixtures/demo.js';
import { contrast } from './color.js';
import { cleanRichtext, cleanText } from './sanitize.js';
import { renderTemplate } from './template.js';
import { loadSectionSchemas, REPO_ROOT, validateTemplate, type SectionSchema } from './theme-schema.js';

let schemas: Map<string, SectionSchema>;

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'build-theme.mjs')], { stdio: 'pipe' });
  schemas = await loadSectionSchemas();
}, 60_000);

describe('catalogue sync', () => {
  it('icon list matches lp-icon.liquid and build script', () => {
    const liquid = readFileSync(path.join(REPO_ROOT, 'shopify/lp/snippets/lp-icon.liquid'), 'utf8');
    const names = [...liquid.matchAll(/when '([a-z-]+)'/g)].map((m) => m[1]).filter((n) => n !== 'x');
    expect(new Set(names)).toEqual(new Set(ICONS));
    const build = readFileSync(path.join(REPO_ROOT, 'scripts/build-theme.mjs'), 'utf8');
    for (const i of ICONS) expect(build).toContain(`'${i}'`);
  });
  it('loads all 13 lp sections', () => {
    expect(schemas.size).toBe(13);
  });
});

describe.each([
  ['demo facts (deployable)', demoFacts],
  ['fixture facts with reviews', fixtureFactsWithReviews],
])('renderTemplate with %s', (_label, facts) => {
  const results = demoConfigs.map((c) => renderTemplate(c, facts, demoBrand, { slug: 'organic-tee' }));

  it('produces templates that validate against the real section schemas', () => {
    for (const r of results) expect(validateTemplate(r.template, schemas), r.config.designName).toEqual([]);
  });

  it('has exactly one H1 per page', () => {
    for (const r of results) {
      const h1s = Object.values(r.template.sections).filter((s) => s.settings.heading_tag === 'h1' || s.settings.title_tag === 'h1');
      expect(h1s.length, r.config.designName).toBe(1);
    }
  });

  it('puts seo first, a primary ATC section second and the sticky bar last', () => {
    for (const r of results) {
      expect(r.renderedOrder[0]).toBe('seo');
      expect(['hero', 'purchase']).toContain(r.renderedOrder[1]);
      const firstContent = r.template.sections[r.template.order[1]];
      if (firstContent.type === 'lp-hero') expect(firstContent.settings.show_buy_form).toBe(true);
      expect(r.renderedOrder.at(-1)).toBe('sticky');
    }
  });

  it('keeps text readable (WCAG AA) in every section', () => {
    for (const r of results)
      for (const [id, s] of Object.entries(r.template.sections)) {
        expect(contrast(String(s.settings.lp_bg), String(s.settings.lp_fg)), `${r.config.designName}/${id}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(String(s.settings.lp_btn_bg), String(s.settings.lp_btn_fg)), `${r.config.designName}/${id} button`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('never outputs unverified trust claims', () => {
    for (const r of results) {
      const json = JSON.stringify(r.template);
      expect(json).not.toContain('made_up_claim');
    }
  });

  it('produces distinct template suffixes per direction', () => {
    expect(new Set(results.map((r) => r.templateSuffix)).size).toBe(4);
  });
});

describe('factual gating', () => {
  it('drops reviews and rating when the source has none', () => {
    const r = renderTemplate(demoConfigs[2], demoFacts, demoBrand, { slug: 'x' });
    expect(r.renderedOrder).not.toContain('reviews');
    const json = JSON.stringify(r.template);
    expect(json).not.toContain('rating_value');
    expect(r.notes.some((n) => n.section === 'reviews')).toBe(true);
  });
  it('fills reviews and rating only from facts', () => {
    const r = renderTemplate(demoConfigs[2], fixtureFactsWithReviews, demoBrand, { slug: 'x' });
    const rev = Object.values(r.template.sections).find((s) => s.type === 'lp-reviews')!;
    expect(Object.keys(rev.blocks!).length).toBe(3);
    expect(rev.settings.rating_value).toBe('4.6');
    const seo = Object.values(r.template.sections).find((s) => s.type === 'lp-seo')!;
    expect(seo.settings.rating_value).toBe('4.6');
  });
  it('drops offer when there is no real offer and no compare-at price', () => {
    const r = renderTemplate(demoConfigs[3], { ...demoFacts, hasCompareAt: false }, demoBrand, { slug: 'x' });
    expect(r.renderedOrder).not.toContain('offer');
  });
  it('moves a purchase CTA to the top when a design starts with content', () => {
    const cfg = { ...demoConfigs[0], sections: [demoConfigs[0].sections[1], ...demoConfigs[0].sections] };
    const r = renderTemplate(cfg, demoFacts, demoBrand, { slug: 'x' });
    expect(r.renderedOrder[1]).toBe('hero');
  });
  it('rejects unknown section types and settings (strict schema)', () => {
    const bad = { ...demoConfigs[0], sections: [{ type: 'custom-html', settings: { html: '<script>' } }] } as never;
    expect(() => renderTemplate(bad, demoFacts, demoBrand, { slug: 'x' })).toThrow();
    const bad2 = structuredClone(demoConfigs[0]) as { sections: { settings: Record<string, unknown> }[] };
    bad2.sections[0].settings.liquid = '{{ shop.secret }}';
    expect(() => renderTemplate(bad2 as never, demoFacts, demoBrand, { slug: 'x' })).toThrow();
  });
});

describe('real-store data edge cases (found on Shopify)', () => {
  it('hides the gallery for a product without images and skips the "Home page" collection in breadcrumbs', async () => {
    const { renderPreview } = await import('./preview.js');
    const { demoProduct } = await import('../fixtures/demo.js');
    const r = renderTemplate(demoConfigs[0], demoFacts, demoBrand, { slug: 'x' });
    const bare = { ...demoProduct, images: [], collection: { title: 'Home page', url: '/collections/frontpage' } };
    const html = await renderPreview(r.template, bare);
    expect(html).not.toContain('lp-gallery');
    expect(html).not.toContain('/collections/frontpage');
    expect(html).toContain('lp-chapter--text');
    const withImgs = await renderPreview(r.template, demoProduct);
    expect(withImgs).toContain('lp-gallery');
    expect(withImgs).toContain('/collections/t-shirts');
  });
});

describe('sanitize', () => {
  it('strips scripts, event handlers, javascript: links and Liquid delimiters', () => {
    const out = cleanRichtext('<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a> {{ shop }} {% render %}</p>', 500);
    expect(out).not.toMatch(/script|onclick|javascript:|\{\{|\{%/);
    expect(out.startsWith('<p>')).toBe(true);
  });
  it('wraps bare text in a paragraph and converts b/i', () => {
    expect(cleanRichtext('Hello <b>bold</b>', 100)).toBe('<p>Hello <strong>bold</strong></p>');
  });
  it('cleans plain text', () => {
    expect(cleanText('  <em>Big</em>\n  tee {{x}} ', 50)).toBe('Big tee x');
  });
});
