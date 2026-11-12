/**
 * Generation runs: created by POST /api/runs, executed in-process in the background with bounded
 * concurrency. Stage progress is persisted on the run row (survives restarts for inspection) and
 * pushed to SSE subscribers. Stalled "running" runs are marked failed on boot (no silent spinners).
 */
import { EventEmitter } from 'node:events';
import pLimit from 'p-limit';
import type { Prisma } from '@prisma/client';
import { BrandProfileSchema } from '../catalogue/brand.js';
import { UsageTracker } from '../ai/client.js';
import { prisma } from '../db.js';
import { analyzeProductUrl, runDirFor } from './analyze.js';
import { runResearch } from './research.js';
import { generateDesigns } from './generate.js';
import { config } from '../config.js';
import type { BrandProfile } from '../catalogue/brand.js';

export interface StageState { stage: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; message?: string; startedAt?: string; finishedAt?: string }

export const PIPELINE: { stage: string; label: string }[] = [
  { stage: 'product', label: 'Analysing product page' },
  { stage: 'brand', label: 'Analysing brand styles' },
  { stage: 'tone', label: 'Tone of voice' },
  { stage: 'competitors', label: 'Finding competitors' },
  { stage: 'learnings', label: 'Learning from competitors' },
  { stage: 'generate', label: 'Generating designs' },
  { stage: 'validate', label: 'Running checks' },
];

export const runEvents = new EventEmitter();
runEvents.setMaxListeners(200);
const limit = pLimit(2);

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function setStage(runId: string, stage: string, status: StageState['status'], message?: string) {
  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const stages = (run.stages as unknown as StageState[]).map((s) =>
    s.stage === stage
      ? { ...s, status, message, ...(status === 'running' ? { startedAt: new Date().toISOString() } : { finishedAt: new Date().toISOString() }) }
      : s,
  );
  await prisma.generationRun.update({ where: { id: runId }, data: { stages: json(stages), stage, status: 'running' } });
  runEvents.emit(runId, { type: 'stage', stage, status, message });
}

export interface RunOptions { competitorUrls?: string[] }

export async function createRun(inputUrl: string, options: RunOptions = {}) {
  const stages: StageState[] = PIPELINE.map((p) => ({ stage: p.stage, status: 'pending' }));
  const run = await prisma.generationRun.create({ data: { inputUrl, status: 'queued', stage: 'queued', stages: json(stages), options: json(options) } });
  void limit(() => executeRun(run.id));
  return run;
}

async function executeRun(runId: string) {
  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const usage = new UsageTracker();
  await prisma.generationRun.update({ where: { id: runId }, data: { status: 'running' } });
  try {
    const result = await analyzeProductUrl(run.inputUrl, runDirFor(runId), usage, (stage, status, message) => setStage(runId, stage, status, message));

    // ---- persist brand (keep user corrections) ----
    const domain = new URL(result.product.finalUrl).hostname.replace(/^www\./, '');
    const existing = await prisma.brand.findUnique({ where: { domain } });
    const extracted = { profile: result.brand.profile, notes: result.brand.notes, palette: result.brand.palette, screenshots: result.brand.screenshots, capturedFrom: result.product.finalUrl };
    const brand = existing
      ? await prisma.brand.update({
          where: { id: existing.id },
          data: {
            extracted: json(extracted),
            ...(existing.editedAt ? {} : { profile: json(result.brand.profile), confidence: json(result.brand.confidence) }),
            name: result.product.facts.brandName,
          },
        })
      : await prisma.brand.create({
          data: { domain, name: result.product.facts.brandName, profile: json(result.brand.profile), confidence: json(result.brand.confidence), extracted: json(extracted) },
        });

    // ---- persist product + variants ----
    const { snapshot, facts, sources, warnings, platform } = result.product;
    const product = await prisma.product.create({
      data: {
        sourceUrl: result.product.finalUrl,
        handle: snapshot.handle,
        title: snapshot.title,
        category: facts.category,
        brandId: brand.id,
        facts: json({ snapshot, facts, sources, warnings, platform }),
        variants: {
          create: snapshot.variants.map((v) => ({
            sourceVariantId: String(v.id),
            title: v.title,
            options: json(v.options),
            priceCents: v.price,
            compareAtCents: v.compareAtPrice ?? null,
            available: v.available,
            sku: v.sku ?? null,
          })),
        },
      },
    });

    await prisma.generationRun.update({ where: { id: runId }, data: { productId: product.id, cost: json(usage.toJSON()) } });
    runEvents.emit(runId, { type: 'analyzed', productId: product.id, brandId: brand.id });

    // ---- competitor research + learnings (partial failure tolerated) ----
    const options = (run.options ?? {}) as RunOptions;
    try {
      await runResearch(runId, runDirFor(runId), facts, result.product.finalUrl, options.competitorUrls ?? [], (stage, status, message) => setStage(runId, stage, status, message));
    } catch (e) {
      await setStage(runId, 'competitors', 'failed', `Research failed: ${(e as Error).message}`);
    }

    // ---- design generation (uses the brand profile as stored, i.e. including user corrections) ----
    let generated = 0;
    if (config.llm.enabled) {
      const brandNow = await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } });
      const designs = await generateDesigns({
        runId,
        runDir: runDirFor(runId),
        productId: product.id,
        facts,
        snapshot,
        brand: brandNow.profile as unknown as BrandProfile,
        usage,
        report: (stage, status, message) => setStage(runId, stage, status, message),
      });
      generated = designs.length;
    } else {
      await setStage(runId, 'generate', 'skipped', 'No ANTHROPIC_API_KEY configured — designs need the LLM for copy');
    }

    // Validation (SEO/AEO/GEO, Lighthouse) arrives in M6; it stays "pending" (not run) — never faked.
    const status = generated ? 'generated' : 'researched';
    await prisma.generationRun.update({ where: { id: runId }, data: { status, stage: status, cost: json(usage.toJSON()) } });
    runEvents.emit(runId, { type: 'status', status, productId: product.id, brandId: brand.id });
  } catch (e) {
    const message = (e as Error).message || 'Unknown error';
    const fresh = await prisma.generationRun.findUnique({ where: { id: runId } });
    const stages = ((fresh?.stages ?? []) as unknown as StageState[]).map((s) => (s.status === 'running' ? { ...s, status: 'failed' as const, message, finishedAt: new Date().toISOString() } : s));
    await prisma.generationRun.update({ where: { id: runId }, data: { status: 'failed', error: message, stages: json(stages), cost: json(usage.toJSON()) } });
    runEvents.emit(runId, { type: 'status', status: 'failed', error: message });
    console.error(`[run ${runId}] failed:`, message);
  }
}

/** On boot: anything left "running"/"queued" from a previous process can never finish — say so. */
export async function failStaleRuns() {
  const res = await prisma.generationRun.updateMany({
    where: { status: { in: ['running', 'queued'] } },
    data: { status: 'failed', error: 'Interrupted: the server restarted while this run was in progress. Start a new run.' },
  });
  if (res.count) console.warn(`[runs] marked ${res.count} interrupted run(s) as failed`);
}

export function validateBrandPatch(body: unknown) {
  return BrandProfileSchema.partial().strict().parse(body);
}
