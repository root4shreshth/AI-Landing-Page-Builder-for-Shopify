// Assembles a complete OS 2.0 theme: vendored Dawn (shopify/base) + our section library overlay
// (shopify/lp) + optional generated templates dir. Optionally zips it for Admin upload.
//
// Usage: node scripts/build-theme.mjs [--zip] [--extra <dir>] [--out <dir>]
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

// Icon names supported by snippets/lp-icon.liquid (kept in sync with backend section catalogue).
const ICONS = ['check', 'truck', 'cash', 'return', 'shield', 'star', 'leaf', 'sparkle', 'clock', 'heart', 'droplet', 'sun', 'ruler', 'box', 'award', 'lock', 'bolt', 'feather', 'gift', 'chat', 'tag'];
const ICON_OPTIONS = ICONS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

// Expand schema placeholders so every LP section exposes the same editable style controls.
//   "__LP_ICONS__"        -> icon select options
//   "__LP_STYLE__"        -> colours, fonts, radius, width, padding
//   "__LP_STYLE_NOPAD__"  -> colours, fonts, radius only (e.g. sticky bar)
async function expandSchemaPartials() {
  const raw = await readFile(path.join(overlayDir, 'partials', 'style-settings.json'), 'utf8');
  const all = JSON.parse(`[${raw}]`);
  const noPad = all.filter((s) => !['lp_width', 'lp_pt', 'lp_pb'].includes(s.id));
  const frag = (arr) => arr.map((s) => JSON.stringify(s)).join(',\n    ');
  const sectionsDir = path.join(outDir, 'sections');
  for (const file of await readdir(sectionsDir)) {
    if (!file.startsWith('lp-') || !file.endsWith('.liquid')) continue;
    const p = path.join(sectionsDir, file);
    const src = await readFile(p, 'utf8');
    if (!src.includes('"__LP_STYLE')) continue;
    const out = src
      .replaceAll('"__LP_STYLE_NOPAD__"', frag(noPad))
      .replaceAll('"__LP_STYLE__"', frag(all))
      .replaceAll('"__LP_ICONS__"', JSON.stringify(ICON_OPTIONS));
    // Validate the resulting schema JSON early so a typo fails the build, not the upload.
    const m = out.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
    if (m) {
      try {
        JSON.parse(m[1]);
      } catch (e) {
        throw new Error(`[theme] invalid schema JSON in ${file}: ${e.message}`);
      }
    }
    await writeFile(p, out);
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(baseDir, outDir, { recursive: true });
await overlay(overlayDir);
if (extraDir) await overlay(path.resolve(extraDir));
await expandSchemaPartials();

const sections = await readdir(path.join(outDir, 'sections'));
console.log(`[theme] built ${outDir} (${sections.filter((s) => s.startsWith('lp-')).length} lp sections)`);

if (args.includes('--zip')) {
  const zipPath = `${outDir}.zip`;
  await zipDir(outDir, zipPath);
  console.log(`[theme] zip ${zipPath}`);
}
