import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { isChecking, runChecks } from '../services/checks.js';
import { buildPackage, deploy, lastPackage } from '../services/publish.js';
import { findShopifyCli } from '../services/shopify-cli.js';

export const publishApi = express.Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Start SEO/browser/Lighthouse checks for a run's current designs (background). */
publishApi.post('/runs/:id/checks', wrap(async (req, res) => {
  const { lighthouse } = z.object({ lighthouse: z.boolean().optional() }).strict().parse(req.body ?? {});
  const run = await prisma.generationRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (isChecking(run.id)) return res.status(202).json({ status: 'already-running' });
  void runChecks(run.id, { lighthouse });
  res.status(202).json({ status: 'started' });
}));

/** Publishing context for the dashboard: CLI availability, configured store, last package, deploy history. */
publishApi.get('/runs/:id/publish', wrap(async (req, res) => {
  const run = await prisma.generationRun.findUnique({ where: { id: req.params.id }, include: { designs: { select: { id: true } } } });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const ids = run.designs.map((d) => d.id);
  const history = (await prisma.publishHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })).filter((h) => (h.designIds as string[]).some((id) => ids.includes(id)));
  res.json({ cliInstalled: !!findShopifyCli(), store: config.shopify.store || null, package: await lastPackage(run.id), history });
}));

publishApi.post('/runs/:id/package', wrap(async (req, res) => {
  const { designIds } = z.object({ designIds: z.array(z.string().uuid()).max(8).optional() }).strict().parse(req.body ?? {});
  res.json(await buildPackage(req.params.id, designIds));
}));

publishApi.post('/runs/:id/deploy', wrap(async (req, res) => {
  const body = z.object({
    store: z.string().trim().toLowerCase(),
    mode: z.enum(['new', 'existing']),
    themeId: z.string().trim().optional(),
    themeName: z.string().trim().max(50).optional(),
    confirmOverwrite: z.literal(true, { errorMap: () => ({ message: 'Confirm that files in the target theme may be overwritten' }) }),
  }).strict().parse(req.body);
  const result = await deploy({ runId: req.params.id, store: body.store, mode: body.mode, themeId: body.themeId, themeName: body.themeName });
  res.json(result);
}));

/** Deployment history across all runs. */
publishApi.get('/deployments', wrap(async (_req, res) => {
  res.json(await prisma.publishHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
}));
