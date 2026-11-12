/**
 * Writes the demo product as a Shopify import CSV: storage/exports/demo-product.csv
 * Import via Shopify Admin → Products → Import. Usage: npm run -w backend export:demo-csv
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toShopifyProductCsv } from '../export/product-csv.js';
import { demoProduct } from '../fixtures/demo.js';
import { REPO_ROOT } from '../render/theme-schema.js';

const out = path.join(REPO_ROOT, 'storage', 'exports', 'demo-product.csv');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(
  out,
  toShopifyProductCsv(demoProduct, {
    productType: 'T-Shirt',
    tags: ['lpb-demo'],
    seoTitle: 'Organic Cotton Crew T-Shirt | Demo Brand',
    seoDescription: 'Midweight 180 GSM crew neck t-shirt in 100% organic cotton. Regular fit, machine washable.',
  }),
);
console.log(out);
