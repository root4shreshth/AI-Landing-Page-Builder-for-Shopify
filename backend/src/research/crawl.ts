/**
 * Responsible competitor crawling: robots.txt, polite per-host spacing, bounded concurrency, timeouts,
 * one retry, SSRF-guarded browser. Captures mobile (primary) + desktop screenshots and structural signals.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { newGuardedContext, openPage } from '../browser/browser.js';
import { config } from '../config.js';
import { HIDE_OVERLAYS } from '../extract/brand-capture.js';
import { checkRobots, politeWait } from '../net/robots.js';
import { assertSafeUrl } from '../net/url-guard.js';
import type { Candidate } from './candidates.js';
import { SIGNALS_SCRIPT, STICKY_SCRIPT, type PageSignals } from './page-signals.js';

export interface CrawlResult {
  candidate: Candidate;
  status: 'crawled' | 'blocked_robots' | 'failed';
  error?: string;
  finalUrl?: string;
  signals?: PageSignals;
  stickyAtc?: boolean;
  screenshots?: { mobile: string; desktop: string | null };
  capturedAt?: string;
}

async function crawlOnce(c: Candidate, outDir: string): Promise<CrawlResult> {
  await assertSafeUrl(c.url);
  const robots = await checkRobots(c.url);
  if (!robots.allowed) return { candidate: c, status: 'blocked_robots', error: robots.reason };
  await politeWait(c.url, robots.crawlDelayMs);
  const dir = path.join(outDir, c.domain.replace(/[^a-z0-9.-]/gi, '_'));
  await mkdir(dir, { recursive: true });

  const mctx = await newGuardedContext({ viewport: { width: 390, height: 844 }, mobile: true });
  let signals: PageSignals;
  let stickyAtc = false;
  let finalUrl = c.url;
  const mobilePath = path.join(dir, 'mobile.jpg');
  try {
    const page = await openPage(mctx, c.url, 35_000);
    finalUrl = page.url();
    await page.evaluate(HIDE_OVERLAYS).catch(() => undefined);
    await page.waitForTimeout(400);
    await writeFile(mobilePath, await page.screenshot({ type: 'jpeg', quality: 65 }));
    signals = (await page.evaluate(SIGNALS_SCRIPT)) as PageSignals;
    // scroll well past the main CTA and look for a sticky add-to-cart
    await page.evaluate(`window.scrollTo(0, Math.max(${(signals.atc.firstTop ?? 0) + 900}, document.documentElement.scrollHeight * 0.45))`);
    await page.waitForTimeout(700);
    stickyAtc = (await page.evaluate(STICKY_SCRIPT)) as boolean;
  } finally {
    await mctx.close();
  }

  let desktopPath: string | null = path.join(dir, 'desktop.jpg');
  const dctx = await newGuardedContext({ viewport: { width: 1440, height: 900 } });
  try {
    await politeWait(c.url, robots.crawlDelayMs);
    const page = await openPage(dctx, c.url, 35_000);
    await page.evaluate(HIDE_OVERLAYS).catch(() => undefined);
    await page.waitForTimeout(300);
    await writeFile(desktopPath, await page.screenshot({ type: 'jpeg', quality: 65 }));
  } catch {
    desktopPath = null; // desktop is evidence only; mobile signals are what we analyse
  } finally {
    await dctx.close();
  }
  return { candidate: c, status: 'crawled', finalUrl, signals, stickyAtc, screenshots: { mobile: mobilePath, desktop: desktopPath }, capturedAt: new Date().toISOString() };
}

export async function crawlCompetitor(c: Candidate, outDir: string): Promise<CrawlResult> {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await crawlOnce(c, outDir);
    } catch (e) {
      lastErr = (e as Error).message.split('\n')[0].slice(0, 200);
      if (/HTTP 4\d\d|not public|not allowed/i.test(lastErr)) break; // permanent
    }
  }
  return { candidate: c, status: 'failed', error: lastErr };
}

export async function crawlAll(cands: Candidate[], outDir: string, onProgress?: (done: number, total: number, r: CrawlResult) => void | Promise<void>): Promise<CrawlResult[]> {
  const limit = pLimit(config.crawl.maxConcurrency);
  let done = 0;
  return Promise.all(
    cands.map((c) =>
      limit(async () => {
        const r = await crawlCompetitor(c, outDir);
        done++;
        await onProgress?.(done, cands.length, r);
        return r;
      }),
    ),
  );
}
