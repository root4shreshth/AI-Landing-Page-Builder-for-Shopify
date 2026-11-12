import express, { type NextFunction, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { BrandProfile } from '../catalogue/brand.js';
import type { Direction } from '../catalogue/page-config.js';
import type { ProductFacts } from '../catalogue/facts.js';
import type { ProductSnapshot } from '../catalogue/product.js';
import { UsageTracker } from '../ai/client.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { runDirFor } from '../services/analyze.js';
import { generateDesigns } from '../services/generate.js';
import { runEvents } from '../services/runs.js';

export const designsApi = express.Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Designs of a run, shaped for the dashboard (preview URL, similarity, feedback). */
designsApi.get('/runs/:id/designs', wrap(async (req, res) => {
  const designs = await prisma.design.findMany({
    where: { runId: req.params.id },
    include: { fingerprint: true, feedback: { orderBy: { createdAt: 'desc' } } },
    orderBy: [{ createdAt: 'asc' }],
  });
  res.json(
    designs.map((d) => {
      const c = d.config as { previewFile?: string; templateFile?: string };
      return { ...d, previewUrl: c.previewFile ? `/files/${c.previewFile}` : null, templateUrl: c.templateFile ? `/files/${c.templateFile}` : null };
    }),
  );
}));

const FeedbackBody = z.object({
  verdict: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(500).optional(),
  tags: z.array(z.enum(['too_similar', 'off_brand', 'too_busy', 'too_plain', 'wrong_tone', 'weak_headline', 'missing_info', 'layout', 'colors', 'other'])).max(6).optional(),
}).strict();

designsApi.post('/designs/:id/feedback', wrap(async (req, res) => {
  const body = FeedbackBody.parse(req.body);
  const design = await prisma.design.findUnique({ where: { id: req.params.id } });
  if (!design) return res.status(404).json({ error: 'Design not found' });
  const reason = [body.reason, ...(body.tags ?? []).map((t) => t.replace(/_/g, ' '))].filter(Boolean).join('; ') || null;
  const [fb, updated] = await prisma.$transaction([
    prisma.designFeedback.create({ data: { designId: design.id, verdict: body.verdict, reason, tags: json(body.tags ?? []) } }),
    prisma.design.update({ where: { id: design.id }, data: { status: body.verdict } }),
  ]);
  runEvents.emit(design.runId, { type: 'design', designId: design.id, status: updated.status });
  res.json({ feedback: fb, design: updated });
}));

const regenerating = new Set<string>();

/** Regenerate one design: same direction, a different structural variant, fresh copy; old one superseded. */
designsApi.post('/designs/:id/regenerate', wrap(async (req, res) => {
  const old = await prisma.design.findUnique({ where: { id: req.params.id }, include: { run: { include: { product: { include: { brand: true } } } } } });
  if (!old) return res.status(404).json({ error: 'Design not found' });
  if (!config.llm.enabled) return res.status(409).json({ error: 'LLM not configured' });
  if (regenerating.has(old.id)) return res.status(202).json({ status: 'already-regenerating' });
  const product = old.run.product;
  if (!product) return res.status(409).json({ error: 'Run has no analysed product' });
  regenerating.add(old.id);
  res.status(202).json({ status: 'regenerating', designId: old.id });

  const stored = product.facts as unknown as { facts: ProductFacts; snapshot: ProductSnapshot };
  const prior = await prisma.design.findMany({ where: { runId: old.runId, direction: old.direction }, select: { config: true } });
  const exclude = prior.map((d) => (d.config as { variantId?: string }).variantId).filter((v): v is string => !!v);
  const usage = new UsageTracker();
  try {
    const [created] = await generateDesigns({
      runId: old.runId,
      runDir: runDirFor(old.runId),
      productId: product.id,
      facts: stored.facts,
      snapshot: stored.snapshot,
      brand: product.brand.profile as unknown as BrandProfile,
      usage,
      directions: [old.direction as Direction],
      excludeVariants: exclude,
      version: old.version + 1,
      parentId: old.id,
      report: async (_stage, status, message) => { runEvents.emit(old.runId, { type: 'regenerate', designId: old.id, status, message }); },
    });
    if (created) await prisma.design.update({ where: { id: old.id }, data: { status: 'superseded' } });
    const run = await prisma.generationRun.findUnique({ where: { id: old.runId } });
    const prevCost = (run?.cost ?? {}) as { usd?: number; entries?: unknown[] };
    const add = usage.toJSON();
    await prisma.generationRun.update({ where: { id: old.runId }, data: { cost: json({ ...prevCost, usd: (prevCost.usd ?? 0) + add.usd, entries: [...(prevCost.entries ?? []), ...add.entries] }) } });
    runEvents.emit(old.runId, { type: 'design', designId: created?.id, replaces: old.id, status: created ? 'draft' : 'failed' });
  } catch (e) {
    runEvents.emit(old.runId, { type: 'regenerate', designId: old.id, status: 'failed', message: (e as Error).message });
  } finally {
    regenerating.delete(old.id);
  }
}));
