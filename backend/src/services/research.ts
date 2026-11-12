/**
 * Competitor research stage for a run: discover -> crawl -> features -> persist -> learnings.
 * Partial failure is fine: failed/blocked sites are stored with their status and reason, and learnings are
 * computed from whatever was crawled successfully (with the real sample size).
 */
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import type { ProductFacts } from '../catalogue/facts.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { discoverCandidates } from '../research/candidates.js';
import { crawlAll } from '../research/crawl.js';
import { deriveFeatures } from '../research/features.js';
import { computeLearnings } from '../research/learnings.js';
import { activeProvider } from '../research/search.js';
import type { StageReporter } from './analyze.js';

const json = (v: unknown) => v as Prisma.InputJsonValue;
/** Paths are stored relative to the storage dir and served under /files. */
const rel = (p: string | null | undefined) => (p ? path.relative(config.storageDir, p).split(path.sep).join('/') : null);

export async function runResearch(runId: string, runDir: string, facts: ProductFacts, productUrl: string, manualUrls: string[], report: StageReporter) {
  await report('competitors', 'running', `Searching for competitors (${activeProvider() ?? 'no search provider'})`);
  const { candidates, queries, notes } = await discoverCandidates(facts, productUrl, { manualUrls, target: 10 });
  if (!candidates.length) {
    await report('competitors', 'failed', notes.join(' ') || 'No competitor pages found');
    await report('learnings', 'skipped', 'No competitor data to learn from');
    return { crawled: 0, notes, queries };
  }

  const rows = await Promise.all(
    candidates.map((c) =>
      prisma.competitor.create({
        data: { runId, url: c.url, domain: c.domain, title: c.title, isIndianD2C: c.isIndianD2C, relevance: c.relevance, rationale: c.rationale, crawlStatus: 'pending', structure: json({ source: c.source, pageType: c.pageType }) },
      }),
    ),
  );
  const idByUrl = new Map(rows.map((r) => [r.url, r.id]));
  await report('competitors', 'running', `Crawling ${candidates.length} pages (robots.txt respected)`);

  const results = await crawlAll(candidates, path.join(runDir, 'competitors'), async (done, total, r) => {
    const id = idByUrl.get(r.candidate.url)!;
    if (r.status === 'crawled' && r.signals) {
      const feats = deriveFeatures(r.signals, !!r.stickyAtc);
      await prisma.competitor.update({
        where: { id },
        data: {
          crawlStatus: 'crawled',
          capturedAt: new Date(r.capturedAt!),
          screenshots: json({ mobile: rel(r.screenshots?.mobile), desktop: rel(r.screenshots?.desktop) }),
          structure: json({ source: r.candidate.source, pageType: r.candidate.pageType, finalUrl: r.finalUrl, sectionOrder: feats.sectionOrder, atcPlacement: feats.atcPlacement, headlineStyle: feats.headlineStyle, imageCount: feats.imageCount, pageHeight: r.signals.pageHeight }),
          findings: { create: Object.entries(feats.features).map(([feature, v]) => ({ feature, value: json(v.value), evidence: v.evidence })) },
        },
      });
    } else {
      await prisma.competitor.update({ where: { id }, data: { crawlStatus: r.status, crawlError: r.error ?? null } });
    }
    await report('competitors', 'running', `Crawled ${done}/${total} (${r.candidate.domain}: ${r.status})`);
  });

  const ok = results.filter((r) => r.status === 'crawled' && r.signals);
  const failed = results.length - ok.length;
  const short = ok.length < 8 ? ` — fewer than 8 usable pages${notes.length ? `; ${notes[0]}` : ''}` : '';
  await report('competitors', ok.length ? 'done' : 'failed', `${ok.length} crawled, ${failed} failed/blocked${short}`);

  if (!ok.length) {
    await report('learnings', 'skipped', 'No pages could be crawled');
    return { crawled: 0, notes, queries };
  }
  await report('learnings', 'running', 'Computing learnings');
  const items = ok.map((r) => ({ id: idByUrl.get(r.candidate.url)!, url: r.candidate.url, domain: r.candidate.domain, features: deriveFeatures(r.signals!, !!r.stickyAtc) }));
  const learnings = computeLearnings(items);
  const category = facts.category || 'other';
  await prisma.categoryLearning.createMany({
    data: learnings.map((l) => ({
      category,
      key: l.key,
      kind: l.kind,
      statement: l.observation,
      hypothesis: l.hypothesis || null,
      recommendation: l.recommendation || null,
      share: l.share,
      supportCount: l.supportCount,
      sampleSize: l.sampleSize,
      sources: json(l.sources),
      runId,
    })),
  });
  const top = learnings.filter((l) => l.kind === 'common').slice(0, 2).map((l) => l.observation).join('; ');
  await report('learnings', 'done', `${learnings.length} learnings from ${ok.length} pages${top ? ` — e.g. ${top}` : ''}`);
  return { crawled: ok.length, notes, queries };
}

/** Category memory: aggregate learnings across runs, weighting by sample size (used by the generator in M4). */
export async function categoryLearnings(category: string) {
  const rows = await prisma.categoryLearning.findMany({ where: { category }, orderBy: { createdAt: 'desc' } });
  const byKey = new Map<string, { key: string; support: number; sample: number; recommendation: string | null; hypothesis: string | null; runs: Set<string>; sources: unknown[] }>();
  for (const r of rows) {
    const e = byKey.get(r.key) ?? { key: r.key, support: 0, sample: 0, recommendation: r.recommendation, hypothesis: r.hypothesis, runs: new Set<string>(), sources: [] };
    e.support += r.supportCount;
    e.sample += r.sampleSize;
    if (r.runId) e.runs.add(r.runId);
    e.sources.push(...(r.sources as unknown[]));
    byKey.set(r.key, e);
  }
  return [...byKey.values()]
    .map((e) => ({ key: e.key, support: e.support, sample: e.sample, share: e.sample ? Math.round((e.support / e.sample) * 100) / 100 : 0, runs: e.runs.size, hypothesis: e.hypothesis, recommendation: e.recommendation, sources: e.sources.slice(0, 20) }))
    .sort((a, b) => b.share - a.share);
}
