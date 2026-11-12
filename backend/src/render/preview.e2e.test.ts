/**
 * Browser checks on the local LiquidJS previews (same Liquid as the theme):
 * responsive overflow at 360/768/1440, one H1, alt text, ATC on first mobile screen, sticky bar,
 * variant/price/availability updates, shared state between main and sticky forms, cart payloads,
 * and JSON-LD validity. Cart requests are simulated in previews; real cart is tested on Shopify.
 */
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoBrand, demoConfigs, demoFacts, demoProduct, fixtureFactsWithReviews } from '../fixtures/demo.js';
import { renderPreview } from './preview.js';
import { renderTemplate } from './template.js';
import { DEFAULT_THEME_DIR, REPO_ROOT } from './theme-schema.js';

let dir: string;
let server: Server;
let base: string;
let browser: Browser;
const pages: { name: string; file: string }[] = [];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lp-preview-'));
  await mkdir(path.join(dir, 'assets'));
  for (const a of ['lp.css', 'lp-cart.js']) await copyFile(path.join(DEFAULT_THEME_DIR, 'assets', a), path.join(dir, 'assets', a));
  const variants: [string, typeof demoFacts][] = [['demo', demoFacts], ['fixture', fixtureFactsWithReviews]];
  for (const [label, facts] of variants) {
    for (const cfg of demoConfigs) {
      const r = renderTemplate(cfg, facts, demoBrand, { slug: 'demo' });
      const html = await renderPreview(r.template, demoProduct, { assetBase: 'assets' });
      const file = `${label}-${r.templateSuffix}.html`;
      await writeFile(path.join(dir, file), html);
      pages.push({ name: `${label}/${cfg.direction}`, file });
    }
  }
  server = createServer(async (req, res) => {
    try {
      const p = path.join(dir, decodeURIComponent(new URL(req.url!, 'http://x').pathname));
      const body = await readFile(p);
      res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(file: string, width: number, height = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  // Block external font requests so tests are deterministic/offline
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${file}`, { waitUntil: 'load' });
  // Cart state must be initialised from valid product JSON (guards against silent data errors)
  await page.waitForFunction(() => !!(window as unknown as { LPCart?: { store: { product: unknown } } }).LPCart?.store.product, null, { timeout: 5000 });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return page;
}

describe('layout at 360 / 768 / 1440', () => {
  for (const width of [360, 768, 1440]) {
    it(`no horizontal overflow, one H1, alt text on all images @${width}`, async () => {
      for (const p of pages) {
        const page = await open(p.file, width);
        const m = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          h1: document.querySelectorAll('h1').length,
          missingAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        }));
        expect(m.overflow, `${p.name} overflow`).toBeLessThanOrEqual(0);
        expect(m.h1, `${p.name} h1`).toBe(1);
        expect(m.missingAlt, `${p.name} alt`).toBe(0);
        expect((page as unknown as { __errors: string[] }).__errors, `${p.name} js errors`).toEqual([]);
        await page.close();
      }
    }, 120_000);
  }
});

describe('mobile purchase UX', () => {
  it('primary add-to-cart is fully visible on the first 360x740 screen', async () => {
    for (const p of pages) {
      const page = await open(p.file, 360, 740);
      const box = await page.locator('[data-lp-form][data-lp-primary] [data-lp-atc]').first().boundingBox();
      expect(box, p.name).not.toBeNull();
      expect(box!.y + box!.height, `${p.name} ATC bottom`).toBeLessThanOrEqual(740);
      await page.close();
    }
  }, 120_000);

  it('sticky bar is hidden initially and appears after the main CTA scrolls away', async () => {
    for (const p of pages) {
      const page = await open(p.file, 360, 740);
      await expect.poll(() => page.locator('[data-lp-sticky]').evaluate((e) => e.classList.contains('is-visible'))).toBe(false);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect.poll(() => page.locator('[data-lp-sticky]').evaluate((e) => e.classList.contains('is-visible')), { timeout: 3000 }).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.locator('[data-lp-sticky]').evaluate((e) => e.classList.contains('is-visible')), { timeout: 3000 }).toBe(false);
      await page.close();
    }
  }, 120_000);
});

describe('variants and cart (simulated Ajax API)', () => {
  const file = () => pages.find((p) => p.name === 'demo/story-led')!.file;

  it('variant change updates price, compare-at and availability', async () => {
    const page = await open(file(), 1440);
    const form = page.locator('[data-lp-form][data-lp-primary]').first();
    await expect.poll(() => form.locator('[data-lp-price]').textContent()).toBe('Rs. 799.00');
    await form.locator('label', { hasText: 'Sand' }).click();
    await expect.poll(() => form.locator('[data-lp-price]').textContent()).toBe('Rs. 849.00');
    expect(await form.locator('[data-lp-compare]').isHidden()).toBe(true);
    await form.locator('label', { hasText: 'Navy' }).click();
    await form.locator('label', { hasText: /^L$/ }).click();
    await expect.poll(() => form.locator('[data-lp-atc]').isDisabled()).toBe(true);
    expect(await form.locator('[data-lp-atc-label]').textContent()).toBe('Sold out');
    expect(page.url()).toContain('variant=1003');
    await page.close();
  });

  it('posts the selected variant id and quantity to /cart/add.js', async () => {
    const page = await open(file(), 1440);
    const form = page.locator('[data-lp-form][data-lp-primary]').first();
    await form.locator('label', { hasText: /^M$/ }).click();
    await form.locator('[data-lp-qty-step="1"]').click();
    await form.locator('[data-lp-atc]').click();
    await expect.poll(() => form.locator('[data-lp-status]').textContent()).toBe('Added to cart.');
    const calls = await page.evaluate(() => (window as unknown as { __lpCartCalls: unknown[] }).__lpCartCalls);
    expect(calls).toEqual([{ id: 1002, quantity: 2 }]);
    await page.close();
  });

  it('sticky bar shares variant and quantity state with the main form', async () => {
    const page = await open(file(), 360, 740);
    const form = page.locator('[data-lp-form][data-lp-primary]').first();
    await form.locator('label', { hasText: 'Sand' }).click();
    await form.locator('[data-lp-qty-step="1"]').click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const sticky = page.locator('[data-lp-sticky]');
    await expect.poll(() => sticky.evaluate((e) => e.classList.contains('is-visible'))).toBe(true);
    expect(await sticky.locator('[data-lp-variant-title]').textContent()).toBe('S / Sand');
    expect(await sticky.locator('[data-lp-price]').textContent()).toBe('Rs. 849.00');
    await sticky.locator('[data-lp-atc]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __lpCartCalls: unknown[] }).__lpCartCalls.length)).toBe(1);
    const calls = await page.evaluate(() => (window as unknown as { __lpCartCalls: unknown[] }).__lpCartCalls);
    expect(calls).toEqual([{ id: 1004, quantity: 2 }]);
    await page.close();
  });

  it('shows an error message when the cart API rejects the request', async () => {
    const page = await open(file(), 1440);
    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({ status: 422, description: 'You can only add 1 of this item to your cart.' }), { status: 422 });
    });
    const form = page.locator('[data-lp-form][data-lp-primary]').first();
    await form.locator('[data-lp-atc]').click();
    await expect.poll(() => form.locator('[data-lp-status]').textContent()).toBe('You can only add 1 of this item to your cart.');
    expect(await form.locator('[data-lp-status]').getAttribute('data-kind')).toBe('error');
    expect(await form.locator('[data-lp-atc]').isDisabled()).toBe(false);
    await page.close();
  });
});

describe('structured data', () => {
  it('all JSON-LD parses; Product has one offer per variant; FAQPage matches visible questions', async () => {
    for (const p of pages) {
      const page = await open(p.file, 1440);
      const data = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''));
      const parsed = data.map((d) => JSON.parse(d));
      const product = parsed.find((d) => d['@type'] === 'Product');
      expect(product, p.name).toBeTruthy();
      expect(product.offers.length).toBe(demoProduct.variants.length);
      expect(product.offers[0].price).toBe(799);
      expect(product.offers[2].availability).toBe('https://schema.org/OutOfStock');
      const visibleRating = await page.locator('.lp-rating, .lp-reviews__summary').count();
      expect(!!product.aggregateRating, `${p.name} rating schema only when visible`).toBe(visibleRating > 0);
      const faq = parsed.find((d) => d['@type'] === 'FAQPage');
      const visibleQs = await page.locator('.lp-faq summary').count();
      expect(faq?.mainEntity.length ?? 0, p.name).toBe(visibleQs);
      await page.close();
    }
  }, 120_000);
});
