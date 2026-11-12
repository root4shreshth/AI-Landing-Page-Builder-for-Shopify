import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import { BrandProfileSchema, type BrandConfidence, type BrandProfile } from '../catalogue/brand.js';
import { ProductFactsSchema } from '../catalogue/facts.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { UnsafeUrlError, assertSafeUrlShape } from '../net/url-guard.js';
import { createRun, PIPELINE, runEvents } from '../services/runs.js';

export const api = express.Router();
const json = (v: unknown) => v as Prisma.InputJsonValue;
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// ---------------- runs ----------------
api.post('/runs', wrap(async (req, res) => {
  const { url } = z.object({ url: z.string().trim().min(1).max(2048) }).parse(req.body);
  assertSafeUrlShape(url); // fast structural check; DNS + robots are checked in the run
  // idempotency: same URL submitted within 10s returns the existing run (double clicks)
  const recent = await prisma.generationRun.findFirst({ where: { inputUrl: url, createdAt: { gte: new Date(Date.now() - 10_000) } }, orderBy: { createdAt: 'desc' } });
  const run = recent ?? (await createRun(url));
  res.status(202).json({ id: run.id, status: run.status });
}));

api.get('/runs', wrap(async (_req, res) => {
  const runs = await prisma.generationRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { product: { select: { id: true, title: true, category: true, brand: { select: { id: true, name: true, domain: true } } } }, _count: { select: { designs: true } } },
  });
  res.json(runs);
}));

api.get('/runs/:id', wrap(async (req, res) => {
  const run = await prisma.generationRun.findUnique({
    where: { id: req.params.id },
    include: { product: { include: { brand: true, variants: true } } },
  });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ ...run, pipeline: PIPELINE });
}));

api.get('/runs/:id/events', wrap(async (req, res) => {
  const run = await prisma.generationRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'snapshot', status: run.status, stages: run.stages, error: run.error });
  const onEvent = (e: unknown) => send(e);
  runEvents.on(run.id, onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(ping);
    runEvents.off(run.id, onEvent);
  });
}));

// ---------------- brands ----------------
api.get('/brands/:id', wrap(async (req, res) => {
  const brand = await prisma.brand.findUnique({ where: { id: req.params.id } });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(brand);
}));

/** Partial update of the editable profile; edited fields get confidence 1.0 with source "user". */
api.patch('/brands/:id', wrap(async (req, res) => {
  const brand = await prisma.brand.findUnique({ where: { id: req.params.id } });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const patch = BrandProfileSchema.deepPartial().strict().parse(req.body);
  const current = brand.profile as unknown as BrandProfile;
  const merged = BrandProfileSchema.parse({
    ...current,
    ...patch,
    colors: { ...current.colors, ...patch.colors },
    fonts: {
      ...current.fonts,
      ...patch.fonts,
      heading: { ...current.fonts.heading, ...patch.fonts?.heading, ...(patch.fonts?.heading?.handle ? { matched: 'exact' } : {}) },
      body: { ...current.fonts.body, ...patch.fonts?.body, ...(patch.fonts?.body?.handle ? { matched: 'exact' } : {}) },
    },
    button: { ...current.button, ...patch.button },
  });
  const conf = { ...(brand.confidence as unknown as BrandConfidence) };
  const mark = (k: string) => (conf[k] = { value: 1, source: 'user' });
  Object.keys(patch.colors ?? {}).forEach(mark);
  if (patch.fonts?.heading) mark('headingFont');
  if (patch.fonts?.body) mark('bodyFont');
  if (patch.button) mark('radius');
  if (patch.spacing) mark('spacing');
  if (patch.tone || patch.toneSummary) mark('tone');
  if (patch.imageStyle) mark('imageStyle');
  const updated = await prisma.brand.update({ where: { id: brand.id }, data: { profile: json(merged), confidence: json(conf), editedAt: new Date() } });
  res.json(updated);
}));

api.post('/brands/:id/reset', wrap(async (req, res) => {
  const brand = await prisma.brand.findUnique({ where: { id: req.params.id } });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const extracted = brand.extracted as { profile: BrandProfile };
  const updated = await prisma.brand.update({ where: { id: brand.id }, data: { profile: json(extracted.profile), editedAt: null } });
  res.json(updated);
}));

// ---------------- product facts (user verification) ----------------
const FactsPatch = z.object({
  claims: ProductFactsSchema.shape.claims.optional(),
  offer: ProductFactsSchema.shape.offer.nullable().optional(),
  specs: ProductFactsSchema.shape.specs.optional(),
  highlights: ProductFactsSchema.shape.highlights.optional(),
  category: z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/).optional(),
}).strict();

api.patch('/products/:id/facts', wrap(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const patch = FactsPatch.parse(req.body);
  const stored = product.facts as { facts: Record<string, unknown> } & Record<string, unknown>;
  const facts = { ...stored.facts, ...patch, offer: patch.offer === null ? undefined : patch.offer ?? stored.facts.offer };
  const parsed = ProductFactsSchema.parse(facts);
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { facts: json({ ...stored, facts: parsed, userEditedAt: new Date().toISOString() }), category: parsed.category ?? product.category },
  });
  res.json(updated);
}));

// ---------------- files (screenshots) ----------------
export const files = express.Router();
files.use('/runs', express.static(path.join(config.storageDir, 'runs'), { fallthrough: false, index: false, dotfiles: 'deny' }));

// ---------------- errors ----------------
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  if (err instanceof UnsafeUrlError) return res.status(400).json({ error: err.message });
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) return res.status(status).json({ error: (err as Error).message });
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
}
