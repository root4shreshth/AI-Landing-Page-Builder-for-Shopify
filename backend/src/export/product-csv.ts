/**
 * Shopify product CSV export (Admin → Products → Import). Lets a CLI-only setup (no Admin API token)
 * recreate an analysed product on the dev store, so the landing page template has a real product with
 * real, store-native variant IDs to add to cart.
 *
 * Format: one row per variant; product-level columns only on the first row; extra images on extra rows.
 * Only http(s) image URLs are exported (Shopify downloads them during import).
 */
import type { ProductSnapshot } from '../catalogue/product.js';

export const CSV_COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
  'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping',
  'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
  'SEO Title', 'SEO Description', 'Variant Image', 'Variant Weight Unit', 'Status',
] as const;
type Col = (typeof CSV_COLUMNS)[number];
type Row = Partial<Record<Col, string>>;

export interface CsvOptions {
  productType?: string;
  tags?: string[];
  /** stock for available variants (unavailable variants get 0 with policy "deny" so they show as sold out) */
  stock?: number;
  status?: 'active' | 'draft';
  seoTitle?: string;
  seoDescription?: string;
}

const money = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));
const isHttp = (u: string) => /^https?:\/\//i.test(u);

export function escapeCsv(value: string): string {
  // Neutralise spreadsheet formula injection (scraped text may be opened in Excel/Sheets).
  // '-' is not included: it is common in legitimate values like option names.
  let v = /^[=+@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toShopifyProductCsv(p: ProductSnapshot, opts: CsvOptions = {}): string {
  const stock = String(opts.stock ?? 25);
  const optionNames = p.options.length ? p.options.slice(0, 3) : ['Title'];
  const images = p.images.filter((i) => isHttp(i.src));
  const rows: Row[] = [];

  p.variants.forEach((v, i) => {
    const row: Row = {
      Handle: p.handle,
      'Variant SKU': v.sku ?? '',
      'Variant Grams': '0',
      'Variant Inventory Tracker': 'shopify',
      'Variant Inventory Qty': v.available ? stock : '0',
      'Variant Inventory Policy': 'deny',
      'Variant Fulfillment Service': 'manual',
      'Variant Price': money(v.price),
      'Variant Compare At Price': v.compareAtPrice && v.compareAtPrice > v.price ? money(v.compareAtPrice) : '',
      'Variant Requires Shipping': 'TRUE',
      'Variant Taxable': 'TRUE',
      'Variant Barcode': v.barcode ?? '',
      'Variant Weight Unit': 'kg',
    };
    optionNames.forEach((name, oi) => {
      const n = (oi + 1) as 1 | 2 | 3;
      if (i === 0) row[`Option${n} Name`] = name;
      row[`Option${n} Value`] = p.options.length ? (v.options[oi] ?? '') : 'Default Title';
    });
    if (i === 0) {
      Object.assign(row, {
        Title: p.title,
        'Body (HTML)': p.descriptionHtml,
        Vendor: p.vendor ?? '',
        Type: opts.productType ?? '',
        Tags: (opts.tags ?? []).join(', '),
        Published: 'TRUE',
        'Gift Card': 'FALSE',
        'SEO Title': opts.seoTitle ?? '',
        'SEO Description': opts.seoDescription ?? '',
        Status: opts.status ?? 'active',
      } satisfies Row);
    }
    if (images[i]) Object.assign(row, { 'Image Src': images[i].src, 'Image Position': String(i + 1), 'Image Alt Text': images[i].alt ?? '' });
    rows.push(row);
  });

  // Remaining images on image-only rows
  for (let i = p.variants.length; i < images.length; i++) {
    rows.push({ Handle: p.handle, 'Image Src': images[i].src, 'Image Position': String(i + 1), 'Image Alt Text': images[i].alt ?? '' });
  }

  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => escapeCsv(r[c] ?? '')).join(','));
  return lines.join('\r\n') + '\r\n';
}
