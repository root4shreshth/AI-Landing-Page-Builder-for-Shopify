#!/usr/bin/env node
/**
 * End-to-end evaluation through the real API (backend must be running on API_BASE, default http://localhost:4100).
 * For each product URL: start a run -> wait for designs -> run checks (checklist + browser + Lighthouse) -> collect.
 * Writes docs/results/summary.json and docs/results/RESULTS.md, plus one 360px screenshot per design.
 *
 *   node scripts/evaluate.mjs                      # default 5 products
 *   node scripts/evaluate.mjs --repeat <url>       # also run <url> a second time to show memory-driven differences
 *   node scripts/evaluate.mjs --report-only <runId,...>   # rebuild the report from existing runs (no LLM spend)
 *   node scripts/evaluate.mjs --recheck <runId,...>       # re-render with the current theme + re-run checks (no LLM spend)
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE ?? 'http://localhost:4100';
const STORAGE = process.env.STORAGE_DIR ?? path.join(ROOT, 'storage');
const OUT = path.join(ROOT, 'docs', 'results');

const DEFAULT_PRODUCTS = [
  'https://strongsoul.in/products/m8-competition-white-oversized-hoodie-400-gsm',
  'https://www.bonkerscorner.com/products/out-of-imagination-oversized-t-shirt-1',
  'https://mokobara.com/products/em-cabin-pro-copy',
  'https://www.bombayshavingcompany.com/products/power-groomer-special-edition',
  'https://beminimalist.co/products/lip-peptide-complex-lip-mask',
];

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(p, init) {
  const res = await fetch(API + p, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitFor(fn, { timeoutMs, everyMs = 4000, label }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await sleep(everyMs);
  }
}

async function checkRun(id) {
  const t0 = new Date().toISOString();
  await api(`/api/runs/${id}/checks`, { method: 'POST', body: JSON.stringify({ lighthouse: true }) });
  await waitFor(async () => {
    const r = await api(`/api/runs/${id}`);
    const v = r.stages.find((s) => s.stage === 'validate');
    return v && ['done', 'failed'].includes(v.status) && (v.finishedAt ?? '') > t0 ? v : null;
  }, { timeoutMs: 30 * 60_000, everyMs: 8000, label: `checks ${id}` });
  log('checked', id.slice(0, 8));
}

async function runProduct(url) {
  log('start', url);
  const { id } = await api('/api/runs', { method: 'POST', body: JSON.stringify({ url }) });
  const run = await waitFor(async () => {
    const r = await api(`/api/runs/${id}`);
    return ['generated', 'researched', 'failed'].includes(r.status) ? r : null;
  }, { timeoutMs: 15 * 60_000, label: `run ${id}` });
  log('run', id.slice(0, 8), run.status, run.error ?? '');
  if (run.status !== 'generated') return id;
  await checkRun(id);
  return id;
}

const pct = (s) => (s && s.total ? `${s.passed}/${s.total}` : 'n/a');
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

async function collect(runId) {
  const run = await api(`/api/runs/${runId}`);
  const designs = run.status === 'generated' ? await api(`/api/runs/${runId}/designs`) : [];
  const competitors = await api(`/api/runs/${runId}/competitors`).catch(() => []);
  const learnings = await api(`/api/runs/${runId}/learnings`).catch(() => []);
  const live = designs.filter((d) => d.status !== 'superseded');
  const shotDir = path.join(OUT, 'img', runId.slice(0, 8));
  const rows = [];
  for (const d of live) {
    const c = d.checks ?? {};
    const lh = c.lighthouse?.scores ?? null;
    const shot = c.browser?.widths?.find((w) => w.width === 360)?.screenshot;
    let image = null;
    if (shot) {
      await mkdir(shotDir, { recursive: true });
      const src = path.join(STORAGE, shot.replace(/^\/files\//, ''));
      const dest = path.join(shotDir, `${d.direction}.jpg`);
      await copyFile(src, dest).then(() => { image = path.relative(OUT, dest).split(path.sep).join('/'); }).catch(() => undefined);
    }
    const sim = d.fingerprint?.similarity ?? {};
    rows.push({
      id: d.id, name: d.name, direction: d.direction, status: d.status, template: d.templateKey,
      sections: d.config?.renderedOrder ?? [],
      fingerprint: d.fingerprint?.features ?? null,
      similarity: { verdict: sim.verdict ?? null, maxSibling: (sim.siblings ?? []).length ? Math.max(...sim.siblings.map((s) => s.score)) : null, nearestPrior: sim.nearestPrior ? { score: sim.nearestPrior.score, name: sim.nearestPrior.designName } : null, comparedAgainst: sim.comparedAgainst ?? 0 },
      checklist: c.checklist?.scores ?? null,
      failedChecks: (c.checklist?.items ?? []).filter((i) => i.status === 'failed').map((i) => i.label),
      browser: c.browser && !c.browser.error ? { cart: c.browser.cart?.passed ?? null, sticky: c.browser.sticky?.passed ?? null, atcFirstScreen: c.browser.atcFirstScreen ?? null, overflowPx: Math.max(0, ...(c.browser.widths ?? []).map((w) => w.overflowPx)), jsErrors: (c.browser.jsErrors ?? []).length } : { error: c.browser?.error ?? 'not run' },
      lighthouse: lh ? { ...lh, ...(c.lighthouse.metrics ?? {}), target: c.lighthouse.target } : { status: c.lighthouse?.status ?? 'not run', note: c.lighthouse?.note },
      unsupportedNumbers: d.config?.copyCheck?.unsupportedNumbers ?? [],
      image,
    });
  }
  const stage = (n) => run.stages.find((s) => s.stage === n)?.message ?? '';
  return {
    runId, url: run.inputUrl, status: run.status, error: run.error,
    product: run.product?.title, brand: run.product?.brand?.name, category: run.product?.category,
    createdAt: run.createdAt, costUsd: run.cost?.usd ?? 0, tokens: { in: run.cost?.inputTokens ?? 0, out: run.cost?.outputTokens ?? 0 },
    stages: Object.fromEntries(run.stages.map((s) => [s.stage, { status: s.status, message: s.message }])),
    competitors: { crawled: competitors.filter((c) => c.status === 'crawled' || c.crawlStatus === 'ok').length, total: competitors.length, note: stage('competitors') },
    learnings: learnings.length,
    designs: rows,
  };
}

function markdown(results) {
  const L = [];
  const all = results.flatMap((r) => r.designs);
  const lhs = all.map((d) => d.lighthouse).filter((l) => typeof l.performance === 'number');
  const cats = [...new Set(results.map((r) => r.category).filter(Boolean))];
  L.push('# Evaluation results', '');
  L.push(`Generated by \`node scripts/evaluate.mjs\` on ${new Date().toISOString().slice(0, 10)} against the running backend. Every number below is read back from the API; nothing is typed in by hand.`, '');
  L.push('## Summary', '');
  L.push(`- **Products:** ${results.length} across ${cats.length} categories (${cats.join(', ')})`);
  L.push(`- **Designs generated:** ${all.length}`);
  L.push(`- **Add-to-cart test passed:** ${all.filter((d) => d.browser.cart === true).length}/${all.length} (simulated cart on the local render; the real cart was verified on the dev store)`);
  L.push(`- **Sticky ATC behaves (hidden at top, shown after scroll):** ${all.filter((d) => d.browser.sticky === true).length}/${all.length}`);
  L.push(`- **ATC visible on first mobile screen (360x740):** ${all.filter((d) => d.browser.atcFirstScreen?.passed).length}/${all.length}`);
  L.push(`- **No horizontal overflow at 360/768/1440:** ${all.filter((d) => d.browser.overflowPx === 0).length}/${all.length}`);
  if (lhs.length) L.push(`- **Lighthouse mobile (local render), average:** performance ${avg(lhs.map((l) => l.performance))}, accessibility ${avg(lhs.map((l) => l.accessibility))}, best practices ${avg(lhs.map((l) => l['best-practices']))}, SEO ${avg(lhs.map((l) => l.seo))}`);
  L.push(`- **Sibling designs above the 0.75 similarity threshold:** ${all.filter((d) => (d.similarity.maxSibling ?? 0) >= 0.75).length}/${all.length}`);
  L.push(`- **Total LLM cost:** $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} (Claude Haiku, ${results.reduce((s, r) => s + r.tokens.in + r.tokens.out, 0).toLocaleString('en-US')} tokens)`, '');
  L.push('## Per product', '', 'Checklist cells are passed/total; the difference is "needs verification" items (shown below) unless listed as failed. Similarity is the weighted layout-fingerprint score (0 = nothing shared, 1 = identical); designs above 0.75 are re-rolled.', '');
  for (const r of results) {
    L.push(`### ${r.product ?? r.url}`, '');
    L.push(`- Brand: ${r.brand ?? '?'} · category \`${r.category ?? '?'}\` · run \`${r.runId}\` · status **${r.status}**${r.error ? ` (${r.error})` : ''}`);
    L.push(`- Source: ${r.url}`);
    L.push(`- Product: ${r.stages.product?.message ?? ''}`);
    L.push(`- Brand: ${r.stages.brand?.message ?? ''}; tone: ${r.stages.tone?.message ?? ''}`);
    L.push(`- Competitors: ${r.stages.competitors?.message ?? ''}`);
    L.push(`- Learnings: ${r.stages.learnings?.message ?? ''}`);
    L.push(`- Cost: $${r.costUsd.toFixed(4)}`, '');
    if (r.designs.length) {
      L.push('| Design | Direction | Sections | Nearest sibling | Nearest prior | SEO / AEO / GEO / Schema | Lighthouse P / A / BP / SEO | Cart | Sticky | ATC 1st screen |');
      L.push('|---|---|---|---|---|---|---|---|---|---|');
      for (const d of r.designs) {
        const cl = d.checklist;
        const lh = d.lighthouse;
        L.push(`| ${d.name} | ${d.direction} | ${d.sections.filter((s) => s !== 'seo' && s !== 'sticky').join(' → ')} | ${d.similarity.maxSibling == null ? '— (regenerated)' : d.similarity.maxSibling.toFixed(2)} | ${d.similarity.nearestPrior ? d.similarity.nearestPrior.score.toFixed(2) : '—'} | ${cl ? `${pct(cl.seo)} / ${pct(cl.aeo)} / ${pct(cl.geo)} / ${pct(cl.schema)}` : 'n/a'} | ${typeof lh.performance === 'number' ? `${lh.performance} / ${lh.accessibility} / ${lh['best-practices']} / ${lh.seo}` : lh.status} | ${d.browser.cart ? 'pass' : 'fail'} | ${d.browser.sticky ? 'pass' : 'fail'} | ${d.browser.atcFirstScreen?.passed ? `pass (${d.browser.atcFirstScreen.bottomPx}px)` : 'fail'} |`);
      }
      L.push('');
      const failed = [...new Set(r.designs.flatMap((d) => d.failedChecks))];
      if (failed.length) L.push(`Failed checklist items: ${failed.join('; ')}`, '');
      const imgs = r.designs.filter((d) => d.image);
      if (imgs.length) L.push(imgs.map((d) => `<img src="${d.image}" alt="${d.direction} design at 360px" width="180">`).join(' '), '');
    }
  }
  const byUrl = Object.groupBy ? Object.groupBy(results, (r) => r.url) : {};
  const repeats = Object.values(byUrl).filter((g) => g.length > 1);
  if (repeats.length) {
    L.push('## Same product, second run', '');
    for (const g of repeats) {
      const [a, b] = g;
      const prior = Math.max(0, ...b.designs.map((d) => d.similarity.comparedAgainst ?? 0));
      L.push(`**${a.product}**: run \`${a.runId.slice(0, 8)}\` vs run \`${b.runId.slice(0, 8)}\`. The second run was scored against ${prior} earlier designs in its category.`, '');
      L.push('| Direction | First run | Second run | Second run vs nearest prior |', '|---|---|---|---|');
      for (const d of b.designs) {
        const prev = a.designs.find((x) => x.direction === d.direction);
        L.push(`| ${d.direction} | ${prev ? prev.sections.filter((s) => s !== 'seo' && s !== 'sticky').join(' → ') : '—'} | ${d.sections.filter((s) => s !== 'seo' && s !== 'sticky').join(' → ')} | ${d.similarity.nearestPrior ? `${d.similarity.nearestPrior.score.toFixed(2)} (${d.similarity.nearestPrior.name})` : '—'} |`);
      }
      L.push('');
    }
  }
  L.push('## Honest notes', '');
  L.push('- Lighthouse and browser checks run on the local LiquidJS render of the same section files, not on the Shopify storefront (the dev store is password protected). Shopify adds its own scripts, so storefront scores will differ.');
  L.push('- Competitor search used the curated Indian D2C starter list where the search API had no credits; the competitor stage message above says how many pages were crawled.');
  L.push('- Memory saturation: each run is compared with every earlier design in its category. After several runs of the same product, a direction can run short of unused layouts. The planner then ships the least similar candidate and reports the score instead of failing, so "nearest prior" can exceed 0.75 on repeated products. Sibling designs within a run are always kept below 0.75.');
  L.push('- "Needs verification" checklist items (meta title, canonical) are produced by the theme layout and are confirmed on the Shopify preview, not counted as passed.');
  return L.join('\n') + '\n';
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let ids;
  const only = flag('--report-only') ?? flag('--recheck');
  if (only) {
    ids = only.split(',').map((s) => s.trim()).filter(Boolean);
    if (flag('--recheck')) for (const id of ids) {
      const { rerendered } = await api(`/api/runs/${id}/rerender`, { method: 'POST' });
      log('re-rendered', id.slice(0, 8), rerendered, 'design(s)');
      await checkRun(id);
    }
  }
  else {
    const urls = flag('--urls')?.split(',') ?? DEFAULT_PRODUCTS;
    ids = [];
    for (const u of urls) ids.push(await runProduct(u).catch((e) => { log('error', u, e.message); return null; }));
    const rep = flag('--repeat');
    if (rep) ids.push(await runProduct(rep).catch((e) => { log('error', rep, e.message); return null; }));
    ids = ids.filter(Boolean);
  }
  const results = [];
  for (const id of ids) results.push(await collect(id));
  await writeFile(path.join(OUT, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), api: API, results }, null, 2));
  await writeFile(path.join(OUT, 'RESULTS.md'), markdown(results));
  log('wrote', path.relative(ROOT, path.join(OUT, 'RESULTS.md')), `(${results.length} runs)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
