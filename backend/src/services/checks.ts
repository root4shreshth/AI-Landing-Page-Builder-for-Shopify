/**
 * Validation stage: for every current design, run the SEO/AEO/GEO checklist on the rendered page, real
 * browser checks (widths, ATC, sticky, cart) and Lighthouse (mobile). Results are stored on the design and
 * streamed to the dashboard. Nothing is marked passed unless the check actually ran.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import type { ProductFacts } from '../catalogue/facts.js';
import type { ProductSnapshot } from '../catalogue/product.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { closeCheckBrowser, runBrowserChecks } from '../validate/browser-checks.js';
import { runLighthouse } from '../validate/lighthouse.js';
import { runChecklist } from '../validate/seo.js';
import { runDirFor } from './analyze.js';
import { heavy, runEvents, setStage } from './runs.js';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const rel = (p: string) => path.relative(config.storageDir, p).split(path.sep).join('/');
const running = new Set<string>();

export function isChecking(runId: string) {
  return running.has(runId);
}

export async function runChecks(runId: string, opts: { lighthouse?: boolean } = {}) {
  if (running.has(runId)) return;
  running.add(runId);
  if (config.lowMemory) await setStage(runId, 'validate', 'running', 'Queued: one job at a time on this host').catch(() => undefined);
  return heavy(() => checkNow(runId, opts));
}

async function checkNow(runId: string, opts: { lighthouse?: boolean }) {
  try {
    const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, include: { product: true } });
    if (!run.product) throw new Error('Run has no analysed product');
    const stored = run.product.facts as unknown as { facts: ProductFacts; snapshot: ProductSnapshot };
    const designs = await prisma.design.findMany({ where: { runId, status: { not: 'superseded' } }, orderBy: { createdAt: 'asc' } });
    if (!designs.length) throw new Error('No designs to check');
    const variant = stored.snapshot.variants.find((v) => v.available) ?? stored.snapshot.variants[0];
    const soldOut = !stored.snapshot.variants.some((v) => v.available);
    const base = `http://localhost:${config.port}`;
    let i = 0;
    for (const d of designs) {
      i++;
      const c = d.config as { previewFile?: string; copyCheck?: { unsupportedNumbers: string[] } };
      if (!c.previewFile) continue;
      await setStage(runId, 'validate', 'running', `Checking ${i}/${designs.length}: ${d.name} — SEO/AEO/GEO`);
      const html = await readFile(path.join(config.storageDir, c.previewFile), 'utf8');
      const checklist = runChecklist(html, stored.facts, {
        handle: stored.snapshot.handle,
        hasCollection: !!stored.snapshot.collection,
        unsupportedNumbers: c.copyCheck?.unsupportedNumbers ?? [],
        brandName: stored.facts.brandName,
      });
      await setStage(runId, 'validate', 'running', `Checking ${i}/${designs.length}: ${d.name} — browser at 360/768/1440`);
      const shotsDir = path.join(runDirFor(runId), 'checks', d.templateKey);
      const browser = await runBrowserChecks(`${base}/files/${c.previewFile}`, shotsDir, variant.id, { soldOut }).catch((e) => ({ error: (e as Error).message }));
      let lighthouse: unknown = { status: 'not_run', note: config.lighthouse ? 'Skipped' : 'Lighthouse is turned off on this host (LIGHTHOUSE=off; it needs a second full Chrome, more than a 512 MB instance has). Scores from a full machine are in docs/results/RESULTS.md.' };
      if (opts.lighthouse !== false && config.lighthouse) {
        await setStage(runId, 'validate', 'running', `Checking ${i}/${designs.length}: ${d.name} — Lighthouse (mobile)`);
        lighthouse = await runLighthouse(`${base}/files/${c.previewFile}`, 'local-render', path.join(shotsDir, 'lighthouse.html'))
          .then((r) => ({ ...r, reportFile: r.reportFile ? `/files/${rel(r.reportFile)}` : undefined }))
          .catch((e) => ({ status: 'failed', note: (e as Error).message }));
      }
      const checks = {
        ranAt: new Date().toISOString(),
        checklist,
        browser: 'error' in browser ? browser : { ...browser, widths: browser.widths.map((w) => ({ ...w, screenshot: `/files/${rel(w.screenshot)}` })) },
        lighthouse,
      };
      await prisma.design.update({ where: { id: d.id }, data: { checks: json(checks) } });
      runEvents.emit(runId, { type: 'checks', designId: d.id });
    }
    await setStage(runId, 'validate', 'done', `Checked ${designs.length} design(s): checklist, browser and ${opts.lighthouse === false || !config.lighthouse ? 'no Lighthouse' : 'Lighthouse (local render)'}`);
  } catch (e) {
    await setStage(runId, 'validate', 'failed', (e as Error).message).catch(() => undefined);
  } finally {
    await closeCheckBrowser().catch(() => undefined);
    running.delete(runId);
    const r = await prisma.generationRun.findUnique({ where: { id: runId } });
    runEvents.emit(runId, { type: 'status', status: r?.status });
  }
}
