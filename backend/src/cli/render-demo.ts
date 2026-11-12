/**
 * Renders the 4 demo directions into JSON product templates, validates them against the built
 * section schemas, and writes them to storage/generated/demo/templates so they can be overlaid onto
 * the theme:  node scripts/build-theme.mjs --extra storage/generated/demo --zip
 *
 * Usage: npm run -w backend render:demo [-- --fixture]   (--fixture uses sample reviews; never deploy)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoBrand, demoConfigs, demoFacts, fixtureFactsWithReviews } from '../fixtures/demo.js';
import { renderTemplate } from '../render/template.js';
import { loadSectionSchemas, REPO_ROOT, validateTemplate } from '../render/theme-schema.js';

const useFixture = process.argv.includes('--fixture');
const facts = useFixture ? fixtureFactsWithReviews : demoFacts;
const outDir = path.join(REPO_ROOT, 'storage', 'generated', useFixture ? 'fixture' : 'demo', 'templates');

const schemas = await loadSectionSchemas();
await mkdir(outDir, { recursive: true });
let failed = false;
for (const cfg of demoConfigs) {
  const r = renderTemplate(cfg, facts, demoBrand, { slug: 'demo' });
  const errors = validateTemplate(r.template, schemas);
  console.log(`${r.fileName}  [${r.config.direction}]  ${r.renderedOrder.join(' > ')}`);
  for (const n of r.notes) console.log(`   ${n.level}: ${n.message}`);
  if (errors.length) {
    failed = true;
    for (const e of errors) console.error(`   ERROR ${e}`);
    continue;
  }
  await writeFile(path.join(outDir, `product.${r.templateSuffix}.json`), JSON.stringify(r.template, null, 2));
}
console.log(`\nwrote ${outDir}`);
process.exit(failed ? 1 : 0);
