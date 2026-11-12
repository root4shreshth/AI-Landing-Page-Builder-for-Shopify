/**
 * Lighthouse (mobile preset, simulated throttling) using Playwright's Chromium.
 * Scores are measured, never hardcoded; the target the URL points at is stated alongside.
 */
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';

export interface LighthouseResult {
  url: string;
  target: 'local-render' | 'shopify-preview';
  scores: { performance: number | null; accessibility: number | null; seo: number | null; 'best-practices': number | null };
  metrics: { lcpMs: number | null; cls: number | null; tbtMs: number | null };
  failedAudits: { id: string; title: string }[];
  ranAt: string;
}

export async function runLighthouse(url: string, target: LighthouseResult['target']): Promise<LighthouseResult> {
  const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  try {
    const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'seo', 'best-practices'] });
    if (!result) throw new Error('Lighthouse returned no result');
    const lhr = result.lhr;
    const score = (k: string) => (lhr.categories[k]?.score == null ? null : Math.round((lhr.categories[k].score as number) * 100));
    const num = (id: string) => (typeof lhr.audits[id]?.numericValue === 'number' ? Math.round(lhr.audits[id].numericValue! * (id === 'cumulative-layout-shift' ? 1000 : 1)) / (id === 'cumulative-layout-shift' ? 1000 : 1) : null);
    const failed = Object.values(lhr.categories)
      .flatMap((c) => c.auditRefs.filter((r) => r.weight > 0).map((r) => lhr.audits[r.id]))
      .filter((a) => a && a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative')
      .slice(0, 12)
      .map((a) => ({ id: a.id, title: a.title }));
    return {
      url,
      target,
      scores: { performance: score('performance'), accessibility: score('accessibility'), seo: score('seo'), 'best-practices': score('best-practices') },
      metrics: { lcpMs: num('largest-contentful-paint'), cls: num('cumulative-layout-shift'), tbtMs: num('total-blocking-time') },
      failedAudits: failed,
      ranAt: new Date().toISOString(),
    };
  } finally {
    await chrome.kill();
  }
}
