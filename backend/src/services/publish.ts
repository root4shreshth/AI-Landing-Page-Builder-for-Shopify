/**
 * Packaging and deployment:
 *  - buildPackage: complete theme (Dawn + LP sections + this run's selected templates) as a folder + ZIP,
 *    Shopify Theme Check, and a product CSV for stores without the product.
 *  - deploy: `shopify theme push` to an UNPUBLISHED theme (new, or an existing unpublished one by ID) with
 *    --nodelete so files edited in the theme editor that we don't ship are never deleted. The live theme is
 *    never targeted. Every attempt is recorded in PublishHistory.
 */
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { ProductSnapshot } from '../catalogue/product.js';
import { config, REPO_ROOT } from '../config.js';
import { ensureRendered } from './generate.js';
import { heavy } from './runs.js';
import { prisma } from '../db.js';
import { toShopifyProductCsv } from '../export/product-csv.js';
import { runDirFor } from './analyze.js';
import { runShopify, STORE_RE, THEME_ID_RE } from './shopify-cli.js';

const exec = promisify(execFile);
const json = (v: unknown) => v as Prisma.InputJsonValue;
const rel = (p: string) => path.relative(config.storageDir, p).split(path.sep).join('/');

export interface PackageResult {
  designIds: string[];
  templates: string[];
  themeDir: string;
  zipPath: string;
  zipUrl: string;
  zipBytes: number;
  csvUrl: string | null;
  themeCheck: { status: 'passed' | 'failed' | 'not_run'; errors: number; warnings: number; lpIssues: string[]; note?: string };
  builtAt: string;
}

async function selectedDesigns(runId: string, designIds?: string[]) {
  const all = await prisma.design.findMany({ where: { runId, status: { not: 'superseded' } } });
  if (designIds?.length) return all.filter((d) => designIds.includes(d.id));
  const approved = all.filter((d) => d.status === 'approved');
  return approved.length ? approved : all.filter((d) => d.status !== 'rejected');
}

/** Heavy (builds a whole theme, zips it, runs Theme Check), so it shares the one-at-a-time queue on small hosts. */
export function buildPackage(runId: string, designIds?: string[]): Promise<PackageResult> {
  return config.lowMemory ? heavy(() => buildPackageNow(runId, designIds)) : buildPackageNow(runId, designIds);
}

async function buildPackageNow(runId: string, designIds?: string[]): Promise<PackageResult> {
  const runDir = runDirFor(runId);
  await ensureRendered(runId); // templates may be gone after a restart on hosts with temporary disks
  const designs = await selectedDesigns(runId, designIds);
  if (!designs.length) throw Object.assign(new Error('No designs selected — approve at least one design or pick designs to package'), { status: 409 });

  const pkgDir = path.join(runDir, 'package');
  const extraDir = path.join(pkgDir, 'extra');
  const themeDir = path.join(pkgDir, 'theme');
  await rm(pkgDir, { recursive: true, force: true });
  await mkdir(path.join(extraDir, 'templates'), { recursive: true });
  const templates: string[] = [];
  for (const d of designs) {
    const file = `product.${d.templateKey}.json`;
    await cp(path.join(runDir, 'theme', 'templates', file), path.join(extraDir, 'templates', file));
    templates.push(file);
  }
  // fixed script + validated paths (all under our storage dir); no shell
  await exec(process.execPath, [path.join(REPO_ROOT, 'scripts', 'build-theme.mjs'), '--extra', extraDir, '--out', themeDir, '--zip'], { timeout: 120_000, windowsHide: true });
  const zipPath = `${themeDir}.zip`;
  const zipBytes = (await stat(zipPath)).size;

  let themeCheck: PackageResult['themeCheck'] = { status: 'not_run', errors: 0, warnings: 0, lpIssues: [] };
  if (config.lowMemory) {
    themeCheck = { status: 'not_run', errors: 0, warnings: 0, lpIssues: [], note: 'Theme Check is skipped on this small host (it needs more memory than 512 MB). The same sections pass Theme Check with 0 errors in the repository (npm run theme:check).' };
  } else try {
    const r = await runShopify(['theme', 'check', '--path', themeDir, '--output', 'json'], { timeoutMs: 180_000 });
    const j = r.json as { errorCount?: number; warningCount?: number; issues?: { filePath: string; check: string; message: string; severity: string }[] } | null;
    if (j && typeof j.errorCount === 'number') {
      const lp = (j.issues ?? []).filter((i) => /[\\/](sections|snippets|templates)[\\/](lp-|product\.lp-)/.test(i.filePath));
      themeCheck = { status: j.errorCount === 0 ? 'passed' : 'failed', errors: j.errorCount, warnings: j.warningCount ?? 0, lpIssues: lp.map((i) => `${i.severity} ${i.check}: ${path.basename(i.filePath)} — ${i.message}`), note: 'Warnings outside lp-* files come from the stock Dawn theme' };
    } else themeCheck = { status: 'not_run', errors: 0, warnings: 0, lpIssues: [], note: 'Theme Check produced no JSON output' };
  } catch (e) {
    themeCheck = { status: 'not_run', errors: 0, warnings: 0, lpIssues: [], note: (e as Error).message };
  }

  // product CSV (for stores that don't have the product yet)
  const run = await prisma.generationRun.findUnique({ where: { id: runId }, include: { product: true } });
  let csvUrl: string | null = null;
  if (run?.product) {
    const snap = (run.product.facts as { snapshot: ProductSnapshot }).snapshot;
    const csvPath = path.join(pkgDir, 'product.csv');
    await writeFile(csvPath, toShopifyProductCsv(snap, { productType: run.product.category ?? undefined }));
    csvUrl = `/files/${rel(csvPath)}`;
  }

  const result: PackageResult = { designIds: designs.map((d) => d.id), templates, themeDir, zipPath, zipUrl: `/files/${rel(zipPath)}`, zipBytes, csvUrl, themeCheck, builtAt: new Date().toISOString() };
  await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(result, null, 2));
  return result;
}

export async function lastPackage(runId: string): Promise<PackageResult | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path.join(runDirFor(runId), 'package', 'package.json'), 'utf8')) as PackageResult;
  } catch {
    return null;
  }
}

export interface DeployInput { runId: string; store: string; mode: 'new' | 'existing'; themeId?: string; themeName?: string }

/** Runs the Shopify CLI (a separate Node process), so it also waits its turn on small hosts. */
export function deploy(input: DeployInput) {
  return config.lowMemory ? heavy(() => deployNow(input)) : deployNow(input);
}

async function deployNow(input: DeployInput) {
  if (!STORE_RE.test(input.store)) throw Object.assign(new Error('Store must look like your-store.myshopify.com'), { status: 400 });
  if (input.mode === 'existing' && !THEME_ID_RE.test(input.themeId ?? '')) throw Object.assign(new Error('Theme ID must be numeric'), { status: 400 });
  const pkg = await lastPackage(input.runId);
  if (!pkg) throw Object.assign(new Error('Build the theme package first'), { status: 409 });
  await readdir(pkg.themeDir); // package still on disk

  // Never push to the live theme: verify the target's role BEFORE uploading anything.
  if (input.mode === 'existing') {
    const list = await runShopify(['theme', 'list', '--store', input.store, '--json'], { timeoutMs: 120_000 });
    type T = { id: number | string; name: string; role: string };
    const raw = list.json as T[] | { themes?: T[] } | null;
    const themes = Array.isArray(raw) ? raw : Array.isArray(raw?.themes) ? raw!.themes! : null;
    if (!themes) throw Object.assign(new Error('Could not list themes for this store. Is the Shopify CLI logged in? Run "shopify theme list --store ' + input.store + '" in a terminal.'), { status: 502 });
    const target = themes.find((t) => String(t.id) === input.themeId);
    if (!target) throw Object.assign(new Error(`Theme ${input.themeId} does not exist on ${input.store}`), { status: 404 });
    if (target.role === 'live' || target.role === 'main') throw Object.assign(new Error(`Theme ${input.themeId} ("${target.name}") is your live theme. Deploy to an unpublished theme instead.`), { status: 409 });
  }

  const name = (input.themeName ?? `LP ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`).replace(/[^\w .:-]/g, '').slice(0, 50);
  const args = ['theme', 'push', '--path', pkg.themeDir, '--store', input.store, '--json', '--nodelete'];
  if (input.mode === 'new') args.push('--unpublished', '--theme', name);
  else args.push('--theme', input.themeId!);

  const history = await prisma.publishHistory.create({ data: { designIds: json(pkg.designIds), method: 'cli', status: 'pending', store: input.store, themeName: input.mode === 'new' ? name : null, themeId: input.themeId ?? null, zipPath: pkg.zipUrl } });
  try {
    const r = await runShopify(args, { timeoutMs: 600_000 });
    const j = r.json as { status?: string; theme?: { id: string | number; name: string; role: string; previewUrl: string; editorUrl: string }; issues?: { message: string }[] } | null;
    if (r.code !== 0 || !j?.theme) {
      const err = (r.stderr || r.stdout).split('\n').filter((l) => /error|abort|log in|login|authenticate/i.test(l)).slice(-3).join(' ').slice(0, 400) || `Shopify CLI exited with code ${r.code}`;
      await prisma.publishHistory.update({ where: { id: history.id }, data: { status: 'failed', log: err } });
      throw Object.assign(new Error(/log in|login|authenticat/i.test(err) ? 'Shopify CLI is not logged in for this store. Run "shopify theme list --store ' + input.store + '" once in a terminal to log in, then try again.' : err), { status: 502 });
    }
    if (j.theme.role === 'live' || j.theme.role === 'main') {
      await prisma.publishHistory.update({ where: { id: history.id }, data: { status: 'failed', log: 'Refused: target theme is live' } });
      throw Object.assign(new Error('Refusing to treat a live theme as a deployment target'), { status: 409 });
    }
    const issues = (j.issues ?? []).map((i) => i.message);
    const updated = await prisma.publishHistory.update({
      where: { id: history.id },
      data: { status: issues.length ? 'partial' : 'succeeded', themeId: String(j.theme.id), themeName: j.theme.name, previewUrl: j.theme.previewUrl, editorUrl: j.theme.editorUrl, log: issues.join('\n') || null },
    });
    return updated;
  } catch (e) {
    const fresh = await prisma.publishHistory.findUnique({ where: { id: history.id } });
    if (fresh?.status === 'pending') await prisma.publishHistory.update({ where: { id: history.id }, data: { status: 'failed', log: (e as Error).message.slice(0, 400) } });
    throw e;
  }
}
