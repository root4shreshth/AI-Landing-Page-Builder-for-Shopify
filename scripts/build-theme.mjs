// Assembles a complete OS 2.0 theme: vendored Dawn (shopify/base) + our section library overlay
// (shopify/lp) + optional generated templates dir. Optionally zips it for Admin upload.
//
// Usage: node scripts/build-theme.mjs [--zip] [--extra <dir>] [--out <dir>]
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const baseDir = path.join(root, 'shopify', 'base');
const overlayDir = path.join(root, 'shopify', 'lp');
const extraDir = flag('--extra');
const outDir = path.resolve(flag('--out') ?? path.join(root, 'shopify', 'dist', 'theme'));

const THEME_DIRS = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates', 'blocks'];

async function overlay(src) {
  for (const dir of THEME_DIRS) {
    const from = path.join(src, dir);
    if (existsSync(from)) await cp(from, path.join(outDir, dir), { recursive: true, force: true });
  }
}

async function zipDir(dir, zipPath) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const d of THEME_DIRS) {
      if (existsSync(path.join(dir, d))) archive.directory(path.join(dir, d), d);
    }
    archive.finalize();
  });
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(baseDir, outDir, { recursive: true });
await overlay(overlayDir);
if (extraDir) await overlay(path.resolve(extraDir));

const sections = await readdir(path.join(outDir, 'sections'));
console.log(`[theme] built ${outDir} (${sections.filter((s) => s.startsWith('lp-')).length} lp sections)`);

if (args.includes('--zip')) {
  const zipPath = `${outDir}.zip`;
  await zipDir(outDir, zipPath);
  console.log(`[theme] zip ${zipPath}`);
}
