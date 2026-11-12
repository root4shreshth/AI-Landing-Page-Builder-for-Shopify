import { describe, expect, it } from 'vitest';
import { demoProduct } from '../fixtures/demo.js';
import { CSV_COLUMNS, escapeCsv, toShopifyProductCsv } from './product-csv.js';

/** Minimal RFC 4180 parser for assertions. */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (q) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

describe('toShopifyProductCsv', () => {
  const rows = parse(toShopifyProductCsv(demoProduct, { productType: 'T-Shirt', tags: ['demo'] }));
  const col = (name: (typeof CSV_COLUMNS)[number]) => rows[0].indexOf(name);
  const body = rows.slice(1);

  it('has the header and one row per variant, all with the same handle and column count', () => {
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(body).toHaveLength(demoProduct.variants.length);
    for (const r of body) {
      expect(r).toHaveLength(CSV_COLUMNS.length);
      expect(r[col('Handle')]).toBe(demoProduct.handle);
    }
  });

  it('puts product-level fields and option names only on the first row', () => {
    expect(body[0][col('Title')]).toBe(demoProduct.title);
    expect(body[0][col('Option1 Name')]).toBe('Size');
    expect(body[0][col('Option2 Name')]).toBe('Colour');
    expect(body[1][col('Title')]).toBe('');
    expect(body[1][col('Option1 Name')]).toBe('');
  });

  it('exports prices in major units, compare-at only when higher, and sold-out variants with 0 stock', () => {
    expect(body[0][col('Variant Price')]).toBe('799.00');
    expect(body[0][col('Variant Compare At Price')]).toBe('999.00');
    expect(body[3][col('Variant Compare At Price')]).toBe('');
    const navyL = body.find((r) => r[col('Option1 Value')] === 'L' && r[col('Option2 Value')] === 'Navy')!;
    expect(navyL[col('Variant Inventory Qty')]).toBe('0');
    expect(navyL[col('Variant Inventory Policy')]).toBe('deny');
  });

  it('skips non-http images (data URIs cannot be imported)', () => {
    for (const r of body) expect(r[col('Image Src')]).toBe('');
  });

  it('adds image-only rows for extra http images', () => {
    const withImgs = { ...demoProduct, variants: demoProduct.variants.slice(0, 1), images: [{ src: 'https://cdn.example.com/a.jpg' }, { src: 'https://cdn.example.com/b.jpg', alt: 'B' }] };
    const r = parse(toShopifyProductCsv(withImgs)).slice(1);
    expect(r).toHaveLength(2);
    expect(r[1][col('Image Src')]).toBe('https://cdn.example.com/b.jpg');
    expect(r[1][col('Image Position')]).toBe('2');
  });

  it('escapes quotes, commas and newlines, and neutralises formulas', () => {
    expect(escapeCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(escapeCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsv('S-M')).toBe('S-M');
  });
});
