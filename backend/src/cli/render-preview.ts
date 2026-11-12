/**
 * Renders local HTML previews of the 4 demo directions (same Liquid files as the theme, via LiquidJS).
 * Output: storage/generated/<demo|fixture>/preview/*.html (+ assets/)
 * Usage: npm run -w backend render:preview [-- --fixture]
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoBrand, demoConfigs, demoFacts, demoProduct, fixtureFactsWithReviews } from '../fixtures/demo.js';
import { renderPreview } from '../render/preview.js';
import { renderTemplate } from '../render/template.js';
import { DEFAULT_THEME_DIR, REPO_ROOT } from '../render/theme-schema.js';

const useFixture = process.argv.includes('--fixture');
const facts = useFixture ? fixtureFactsWithReviews : demoFacts;
const outDir = path.join(REPO_ROOT, 'storage', 'generated', useFixture ? 'fixture' : 'demo', 'preview');
await mkdir(path.join(outDir, 'assets'), { recursive: true });
for (const a of ['lp.css', 'lp-cart.js']) await copyFile(path.join(DEFAULT_THEME_DIR, 'assets', a), path.join(outDir, 'assets', a));

for (const cfg of demoConfigs) {
  const r = renderTemplate(cfg, facts, demoBrand, { slug: 'demo' });
  const html = await renderPreview(r.template, demoProduct, { assetBase: 'assets', title: `${cfg.designName} (${cfg.direction})` });
  const file = path.join(outDir, `${r.templateSuffix}.html`);
  await writeFile(file, html);
  console.log(file);
}
