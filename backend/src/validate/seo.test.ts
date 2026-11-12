import { describe, expect, it } from 'vitest';
import { demoBrand, demoConfigs, demoFacts, demoProduct } from '../fixtures/demo.js';
import { renderPreview } from '../render/preview.js';
import { renderTemplate } from '../render/template.js';
import { runChecklist } from './seo.js';

const ctx = { handle: demoProduct.handle, hasCollection: true, unsupportedNumbers: [], brandName: 'Demo Brand' };

describe('SEO / AEO / GEO checklist', () => {
  it('passes the core checks on a rendered demo page', async () => {
    const r = renderTemplate(demoConfigs[1], demoFacts, demoBrand, { slug: 'x' });
    const html = await renderPreview(r.template, demoProduct);
    const c = runChecklist(html, demoFacts, ctx);
    const status = Object.fromEntries(c.items.map((i) => [i.id, i.status]));
    expect(status).toMatchObject({ one_h1: 'passed', heading_order: 'passed', img_alt: 'passed', product_schema: 'passed', rating_truthful: 'passed', faq_schema: 'passed', faq_present: 'passed', specs_table: 'passed', no_vague: 'passed', brand_consistent: 'passed', meta_title: 'needs_verification' });
    expect(c.scores.schema.score).toBe(100);
  });
  it('fails policy FAQ answers that are not backed by confirmed promises', async () => {
    const cfg = structuredClone(demoConfigs[1]);
    const faq = cfg.sections.find((s) => s.type === 'faq') as { blocks: { type: 'qa'; settings: { question: string; answer: string } }[] };
    faq.blocks.push({ type: 'qa', settings: { question: 'Do you offer cash on delivery?', answer: '<p>Yes, cash on delivery is available on all orders across India.</p>' } });
    const html = await renderPreview(renderTemplate(cfg, demoFacts, demoBrand, { slug: 'x' }).template, demoProduct);
    const item = runChecklist(html, demoFacts, ctx).items.find((i) => i.id === 'faq_policies')!;
    expect(item.status).toBe('failed');
    expect(item.detail).toContain('cash on delivery');
  });
  it('flags vague claims and unsupported numbers, and treats a missing collection honestly', async () => {
    const html = (await renderPreview(renderTemplate(demoConfigs[0], demoFacts, demoBrand, { slug: 'x' }).template, { ...demoProduct, collection: undefined })).replace('</main>', '<p>The ultimate tee</p></main>');
    const c = runChecklist(html, demoFacts, { ...ctx, hasCollection: false, unsupportedNumbers: ['99%'] });
    const by = (id: string) => c.items.find((i) => i.id === id)!;
    expect(by('no_vague').status).toBe('failed');
    expect(by('numbers_supported').status).toBe('failed');
    expect(by('internal_link').status).toBe('needs_verification');
  });
});
