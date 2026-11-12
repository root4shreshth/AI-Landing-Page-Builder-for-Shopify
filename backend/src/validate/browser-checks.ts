/**
 * Real-browser checks on a design's local preview (our own server, so no SSRF guard is needed):
 * horizontal overflow and one H1 at 360/768/1440, ATC on the first 360x740 screen, sticky bar after
 * scrolling, and the add-to-cart payload (Shopify Ajax Cart API is simulated in previews).
 * Saves a screenshot per width as evidence.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

export interface WidthResult { width: number; overflowPx: number; h1Count: number; screenshot: string }
export interface BrowserChecks {
  widths: WidthResult[];
  atcFirstScreen: { passed: boolean; bottomPx: number | null; viewport: string };
  sticky: { passed: boolean; detail: string };
  cart: { passed: boolean; detail: string };
  jsErrors: string[];
}

let browser: Browser | null = null;
async function getBrowser() {
  if (!browser) browser = await chromium.launch();
  return browser;
}
export async function closeCheckBrowser() {
  await browser?.close();
  browser = null;
}

export async function runBrowserChecks(url: string, outDir: string, expectVariantId: string | number, opts: { soldOut?: boolean } = {}): Promise<BrowserChecks> {
  await mkdir(outDir, { recursive: true });
  const b = await getBrowser();
  const jsErrors: string[] = [];
  const widths: WidthResult[] = [];
  for (const [w, h] of [[360, 740], [768, 1024], [1440, 900]] as const) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => jsErrors.push(`${w}px: ${e.message}`));
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll('h1').length }));
    const shot = path.join(outDir, `${w}.jpg`);
    await page.screenshot({ path: shot, type: 'jpeg', quality: 60, fullPage: false });
    widths.push({ width: w, overflowPx: Math.max(0, m.overflow), h1Count: m.h1, screenshot: shot });
    await page.close();
  }

  const page = await b.newPage({ viewport: { width: 360, height: 740 } });
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { LPCart?: { store: { product: unknown } } }).LPCart?.store.product, null, { timeout: 8000 }).catch(() => undefined);
  const box = await page.locator('[data-lp-form][data-lp-primary] [data-lp-atc]').first().boundingBox().catch(() => null);
  const atcFirstScreen = { passed: !!box && box.y + box.height <= 740, bottomPx: box ? Math.round(box.y + box.height) : null, viewport: '360x740' };

  const stickyBefore = await page.locator('[data-lp-sticky]').evaluate((e) => e.classList.contains('is-visible')).catch(() => null);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  const stickyAfter = await page.locator('[data-lp-sticky]').evaluate((e) => e.classList.contains('is-visible')).catch(() => null);
  const sticky = stickyBefore === null
    ? { passed: false, detail: 'No sticky add-to-cart bar on the page' }
    : { passed: stickyBefore === false && stickyAfter === true, detail: `Hidden at the top: ${!stickyBefore}; shown after scrolling: ${!!stickyAfter}` };

  let cart = { passed: false, detail: 'Add-to-cart not exercised' };
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    const form = page.locator('[data-lp-form][data-lp-primary]').first();
    if (opts.soldOut) {
      // Every variant is sold out on the source store: the correct behaviour is a disabled button that says so.
      const btn = form.locator('[data-lp-atc]');
      const disabled = await btn.isDisabled({ timeout: 3000 });
      const label = ((await btn.textContent()) ?? '').replace(/s+/g, ' ').trim();
      const calls = await page.evaluate(() => ((window as unknown as { __lpCartCalls?: unknown[] }).__lpCartCalls ?? []).length);
      cart = { passed: disabled && /sold out|unavailable/i.test(label) && calls === 0, detail: `Sold out on the source store: button disabled ${disabled}, label "${label}", cart requests ${calls}` };
      await page.close();
      return { widths, atcFirstScreen, sticky, cart, jsErrors };
    }
    await form.locator('[data-lp-qty-step="1"]').click({ timeout: 3000 }).catch(() => undefined);
    await form.locator('[data-lp-atc]').click({ timeout: 5000 });
    await page.waitForFunction(() => ((window as unknown as { __lpCartCalls?: unknown[] }).__lpCartCalls ?? []).length > 0, null, { timeout: 5000 });
    const calls = await page.evaluate(() => (window as unknown as { __lpCartCalls: { id: unknown; quantity: number }[] }).__lpCartCalls);
    // the confirmation is written after the (simulated) response arrives
    await form.locator('[data-lp-status]').filter({ hasText: /\S/ }).waitFor({ timeout: 5000 }).catch(() => undefined);
    const status = await form.locator('[data-lp-status]').textContent();
    const c = calls[0];
    cart = { passed: String(c.id) === String(expectVariantId) && c.quantity >= 1 && /added/i.test(status ?? ''), detail: `Posted variant ${String(c.id)} × ${c.quantity} to /cart/add.js; message "${(status ?? '').trim()}"` };
  } catch (e) {
    cart = { passed: false, detail: `Add-to-cart failed: ${(e as Error).message.split('\n')[0]}` };
  }
  await page.close();
  return { widths, atcFirstScreen, sticky, cart, jsErrors };
}
