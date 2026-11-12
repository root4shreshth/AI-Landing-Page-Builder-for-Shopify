/**
 * Product + brand analysis for one URL: extraction -> brand capture -> derivation -> tone (LLM, optional).
 * Pure orchestration; persistence lives in runs.ts.
 */
import path from 'node:path';
import type { BrandConfidence, BrandProfile } from '../catalogue/brand.js';
import { analyzeTone, type ToneResult } from '../ai/tone.js';
import type { UsageTracker } from '../ai/client.js';
import { config } from '../config.js';
import { captureBrand, type BrandCapture } from '../extract/brand-capture.js';
import { deriveBrandProfile } from '../extract/brand-derive.js';
import { screenshotPalette, type PaletteColor } from '../extract/palette.js';
import { extractProduct, type ExtractedProduct } from '../extract/product.js';
import { checkRobots } from '../net/robots.js';
import { assertSafeUrl } from '../net/url-guard.js';

export interface BrandAnalysis {
  profile: BrandProfile;
  confidence: BrandConfidence;
  notes: string[];
  palette: PaletteColor[];
  screenshots: { desktop: string; mobile: string | null };
  capture: Pick<BrandCapture, 'finalUrl'> & { headings: string[]; ctas: string[] };
}

export type StageReporter = (stage: string, status: 'running' | 'done' | 'failed' | 'skipped', message?: string) => Promise<void>;

export async function analyzeProductUrl(rawUrl: string, runDir: string, usage: UsageTracker, report: StageReporter) {
  const url = (await assertSafeUrl(rawUrl.trim())).toString();
  const robots = await checkRobots(url);
  if (!robots.allowed) throw new Error(`This URL can't be crawled: ${robots.reason}.`);

  await report('product', 'running', 'Reading product data');
  const product: ExtractedProduct = await extractProduct(url);
  await report('product', 'done', `${product.snapshot.title} — ${product.snapshot.variants.length} variant(s), ${product.facts.specs.length} specs, ${product.facts.claims.length} claims`);

  await report('brand', 'running', 'Capturing styles and screenshots');
  const capture = await captureBrand(product.finalUrl, path.join(runDir, 'brand'));
  const palette = screenshotPalette(capture.desktopPng);
  const derived = deriveBrandProfile(capture.desktop, palette);
  await report('brand', 'done', `Primary ${derived.profile.colors.primary}, heading font ${derived.profile.fonts.heading.handle}`);

  let tone: ToneResult | null = null;
  if (config.llm.enabled) {
    await report('tone', 'running', 'Analysing tone of voice');
    try {
      tone = await analyzeTone(
        {
          title: product.snapshot.title,
          vendor: product.snapshot.vendor,
          description: product.facts.descriptionText,
          headings: capture.desktop.headingTexts,
          ctas: capture.desktop.ctaTexts,
          screenshotJpeg: capture.desktopJpeg,
        },
        usage,
      );
      await report('tone', 'done', `${tone.tone.join(', ') || 'unclear'} · ${tone.imageStyle}`);
    } catch (e) {
      await report('tone', 'failed', (e as Error).message);
    }
  } else {
    await report('tone', 'skipped', 'No ANTHROPIC_API_KEY configured — tone left for manual entry');
  }

  const confidence: BrandConfidence = { ...derived.confidence };
  if (tone) {
    confidence.tone = { value: tone.confidence, source: 'llm' };
    confidence.imageStyle = { value: Math.min(0.8, tone.confidence + 0.1), source: 'llm' };
  } else {
    confidence.tone = { value: 0, source: 'default', note: 'not analysed' };
  }
  const profile: BrandProfile = {
    ...derived.profile,
    tone: tone?.tone ?? [],
    toneSummary: tone?.toneSummary ?? '',
    imageStyle: tone?.imageStyle ?? 'unknown',
  };
  // Prefer the deterministic category; use the LLM's when the rules found nothing.
  if (tone && (!product.facts.category || product.facts.category.startsWith('other'))) product.facts.category = tone.category;

  const brand: BrandAnalysis = {
    profile,
    confidence,
    notes: derived.notes,
    palette,
    screenshots: capture.screenshots,
    capture: { finalUrl: capture.finalUrl, headings: capture.desktop.headingTexts, ctas: capture.desktop.ctaTexts },
  };
  return { url, product, brand, tone };
}

export const runDirFor = (runId: string) => path.join(config.storageDir, 'runs', runId);
