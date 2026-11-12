/**
 * Design generation stage: memory retrieval -> structure planning -> copy (LLM) -> assembly -> deterministic
 * render -> schema validation -> local preview -> fingerprint + similarity -> persist.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import type { Prisma } from '@prisma/client';
import { tokensFromProfile, type BrandProfile } from '../catalogue/brand.js';
import type { ProductFacts } from '../catalogue/facts.js';
import type { Direction } from '../catalogue/page-config.js';
import type { ProductSnapshot } from '../catalogue/product.js';
import { unsupportedNumbers, writeCopy } from '../ai/copy.js';
import type { UsageTracker } from '../ai/client.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { assembleConfig } from '../design/assemble.js';
import { explain, fingerprintOf, nearest, similarity, type Fingerprint } from '../design/fingerprint.js';
import { planDesigns, type ChosenPlan, type HistoryItem } from '../design/planner.js';
import { renderPreview } from '../render/preview.js';
import { renderTemplate, templateSuffixFor } from '../render/template.js';
import { DEFAULT_THEME_DIR, loadSectionSchemas, validateTemplate } from '../render/theme-schema.js';
import type { StageReporter } from './analyze.js';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const rel = (p: string) => path.relative(config.storageDir, p).split(path.sep).join('/');
export const SIMILARITY_THRESHOLD = 0.75;

const money = (cents: number, fmt: string) => fmt.replace(/\{\{\s*\w+\s*\}\}/, (cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** Prior designs in the same category (other runs), newest first, with their feedback status. */
export async function categoryHistory(category: string, excludeRunId: string): Promise<(HistoryItem & { runId: string; designName: string })[]> {
  const rows = await prisma.designFingerprint.findMany({
    where: { category, design: { runId: { not: excludeRunId }, status: { not: 'superseded' } } },
    include: { design: { select: { id: true, name: true, status: true, runId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  return rows.map((r) => ({ id: r.design.id, fp: r.features as unknown as Fingerprint, status: r.design.status, label: r.design.name, runId: r.design.runId, designName: r.design.name }));
}

async function categoryFeedback(category: string): Promise<string[]> {
  const fb = await prisma.designFeedback.findMany({
    where: { verdict: 'rejected', reason: { not: null }, design: { fingerprint: { category } } },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return fb.map((f) => f.reason!).filter(Boolean);
}

async function learningSignals(category: string) {
  const rows = await prisma.categoryLearning.findMany({ where: { category } });
  const agg = new Map<string, { support: number; sample: number }>();
  for (const r of rows) {
    const a = agg.get(r.key) ?? { support: 0, sample: 0 };
    a.support += r.supportCount;
    a.sample += r.sampleSize;
    agg.set(r.key, a);
  }
  return [...agg.entries()].map(([key, a]) => ({ key, share: a.sample ? a.support / a.sample : 0, sample: a.sample }));
}

interface GenerateArgs {
  runId: string;
  runDir: string;
  productId: string;
  facts: ProductFacts;
  snapshot: ProductSnapshot;
  brand: BrandProfile;
  usage: UsageTracker;
  report: StageReporter;
  directions?: Direction[];
  excludeVariants?: string[];
  version?: number;
  parentId?: string;
}

export async function generateDesigns(a: GenerateArgs) {
  const category = a.facts.category || 'other';
  await a.report('generate', 'running', 'Retrieving category memory and planning layouts');
  const [history, feedback, learnings, schemas] = await Promise.all([categoryHistory(category, a.runId), categoryFeedback(category), learningSignals(category), loadSectionSchemas()]);
  const plans = planDesigns({
    facts: a.facts,
    imageCount: a.snapshot.images.length,
    learnings,
    history,
    brandSpacing: a.brand.spacing,
    seed: `${a.runId}:${a.version ?? 1}`,
    directions: a.directions,
    excludeVariants: a.excludeVariants,
  });
  const priorNames = (await prisma.design.findMany({ where: { fingerprint: { category } }, select: { name: true, config: true }, take: 30, orderBy: { createdAt: 'desc' } }))
    .flatMap((d) => [d.name, ((d.config as { config?: { sections?: { type: string; settings: { heading?: string } }[] } })?.config?.sections?.[0]?.settings?.heading) ?? ''])
    .filter(Boolean);

  const previewDir = path.join(a.runDir, 'preview');
  const templatesDir = path.join(a.runDir, 'theme', 'templates');
  await mkdir(path.join(previewDir, 'assets'), { recursive: true });
  await mkdir(templatesDir, { recursive: true });
  for (const f of ['lp.css', 'lp-cart.js']) await copyFile(path.join(DEFAULT_THEME_DIR, 'assets', f), path.join(previewDir, 'assets', f));

  const variant = a.snapshot.variants.find((v) => v.available) ?? a.snapshot.variants[0];
  const priceLine = variant ? money(variant.price, a.snapshot.moneyFormat) : '';
  const slug = `${a.snapshot.handle.slice(0, 24)}-${a.runId.slice(0, 6)}`;
  const tokens = tokensFromProfile(a.brand);
  const limit = pLimit(2);
  let done = 0;

  const results = await Promise.all(
    plans.map((plan) =>
      limit(async () => {
        try {
          const copy = await writeCopy({ facts: a.facts, brand: a.brand, plan, priceLine, options: a.snapshot.options, avoid: priorNames, feedback }, a.usage);
          const cfg = assembleConfig(plan, copy, new Set(a.facts.claims.map((c) => c.id)));
          const rendered = renderTemplate(cfg, a.facts, tokens, { slug, version: a.version });
          const errors = validateTemplate(rendered.template, schemas);
          if (errors.length) throw new Error(`Template failed schema validation: ${errors.slice(0, 3).join('; ')}`);
          const templateFile = path.join(templatesDir, `product.${rendered.templateSuffix}.json`);
          await writeFile(templateFile, JSON.stringify(rendered.template, null, 2));
          const html = await renderPreview(rendered.template, a.snapshot, { assetBase: 'assets', title: `${cfg.designName} — ${a.snapshot.title}` });
          const previewFile = path.join(previewDir, `${rendered.templateSuffix}.html`);
          await writeFile(previewFile, html);
          const fp = fingerprintOf(cfg);
          const near = nearest(fp, history.map((h) => ({ id: h.id, label: h.label, fp: h.fp })));
          const unsupported = unsupportedNumbers(copy, a.facts);
          const design = await prisma.design.create({
            data: {
              runId: a.runId,
              direction: plan.direction,
              name: rendered.config.designName,
              templateKey: rendered.templateSuffix,
              version: a.version ?? 1,
              parentId: a.parentId ?? null,
              config: json({
                config: rendered.config,
                label: plan.label,
                variantId: plan.variantId,
                appliedLearnings: plan.appliedLearnings,
                dataNotes: [...plan.dataNotes, ...rendered.notes.map((n) => n.message)],
                copyCheck: { unsupportedNumbers: unsupported },
                renderedOrder: rendered.renderedOrder,
                templateFile: rel(templateFile),
                previewFile: rel(previewFile),
              }),
              fingerprint: {
                create: {
                  category,
                  features: json(fp),
                  similarity: json({
                    threshold: SIMILARITY_THRESHOLD,
                    comparedAgainst: history.length,
                    nearestPrior: near ? { designId: near.id, designName: near.label, score: near.score, features: near.features, explanation: explain(near) } : null,
                    verdict: !near ? 'first-in-category' : near.score >= SIMILARITY_THRESHOLD ? 'similar' : 'distinct',
                    candidatesConsidered: plan.candidatesConsidered,
                  }),
                },
              },
            },
          });
          done++;
          await a.report('generate', 'running', `Generated ${done}/${plans.length}: ${design.name} (${plan.direction})`);
          return { ok: true as const, design, plan };
        } catch (e) {
          done++;
          await a.report('generate', 'running', `Design ${plan.direction} failed: ${(e as Error).message.slice(0, 160)}`);
          return { ok: false as const, plan, error: (e as Error).message };
        }
      }),
    ),
  );

  // sibling similarity (within this run) for the dashboard
  const ok = results.filter((r) => r.ok) as Extract<(typeof results)[number], { ok: true }>[];
  const fps = new Map<string, Fingerprint>();
  for (const r of ok) fps.set(r.design.id, fingerprintOf((r.design.config as { config: Parameters<typeof fingerprintOf>[0] }).config));
  for (const r of ok) {
    const mine = fps.get(r.design.id)!;
    const sib = ok.filter((o) => o.design.id !== r.design.id).map((o) => ({ id: o.design.id, name: o.design.name, score: similarity(mine, fps.get(o.design.id)!).score }));
    const fpRow = await prisma.designFingerprint.findUnique({ where: { designId: r.design.id } });
    await prisma.designFingerprint.update({ where: { designId: r.design.id }, data: { similarity: json({ ...(fpRow?.similarity as object), siblings: sib }) } });
  }
  const failed = results.length - ok.length;
  await a.report('generate', ok.length ? 'done' : 'failed', `${ok.length} design(s) generated${failed ? `, ${failed} failed` : ''}`);
  return ok.map((r) => r.design);
}
