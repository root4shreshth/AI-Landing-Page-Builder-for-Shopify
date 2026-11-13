/**
 * Shared headless Chromium with an SSRF guard on every request the page makes
 * (documents, scripts, images, XHR, redirects): only http(s) to public hosts, plus data:/blob:.
 * Heavy media is blocked to keep crawls fast and polite.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { assertPublicHost, DEFAULT_UA } from '../net/url-guard.js';
import { config } from '../config.js';

/** Container-friendly flags; LOW_MEMORY trims renderer processes and the JS heap for 512 MB hosts. */
export const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  ...(config.lowMemory ? ['--renderer-process-limit=2', '--disable-extensions', '--js-flags=--max-old-space-size=192'] : []),
];

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: CHROMIUM_ARGS }).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}

const hostVerdicts = new Map<string, Promise<boolean>>();
function hostAllowed(host: string): Promise<boolean> {
  let v = hostVerdicts.get(host);
  if (!v) {
    v = assertPublicHost(host).then(() => true, () => false);
    hostVerdicts.set(host, v);
  }
  return v;
}

export interface GuardedContextOptions {
  viewport: { width: number; height: number };
  mobile?: boolean;
}

export async function newGuardedContext(opts: GuardedContextOptions): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 1,
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    userAgent: opts.mobile
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 ' + DEFAULT_UA
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ' + DEFAULT_UA,
    locale: 'en-IN',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.abort('blockedbyclient');
    if (url.port && url.port !== '80' && url.port !== '443') return route.abort('blockedbyclient');
    if (req.resourceType() === 'media' || req.resourceType() === 'websocket') return route.abort('blockedbyclient');
    // LOW_MEMORY: styles and HTML are enough for brand and page signals; scripts/fonts cost most of the CPU and RAM.
    if (config.lowMemory && (req.resourceType() === 'script' || req.resourceType() === 'font')) return route.abort('blockedbyclient');
    if (!(await hostAllowed(url.hostname))) return route.abort('blockedbyclient');
    return route.continue();
  });
  return ctx;
}

/** Navigate with bounded waits; returns the page once DOM is ready and the network has mostly settled. */
export async function openPage(ctx: BrowserContext, url: string, timeoutMs = config.lowMemory ? 60_000 : 30_000): Promise<Page> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeoutMs);
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (!res) throw new Error('Navigation failed (no response)');
  if (res.status() >= 400) throw new Error(`Page returned HTTP ${res.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
  return page;
}
