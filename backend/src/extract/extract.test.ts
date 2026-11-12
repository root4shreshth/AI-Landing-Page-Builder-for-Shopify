import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractClaims } from './claims.js';
import { detectCurrency, detectMoneyFormat, guessCategory, jsonLdNodes, shopifyHandleFromUrl, snapshotFromJsonLd, snapshotFromShopifyJs } from './product.js';
import { extractReviews } from './reviews.js';
import { extractSpecs } from './specs.js';

const shopifyJs = {
  id: 1, title: 'Linen Shirt', handle: 'linen-shirt', description: '<p>Breathable.</p>', vendor: 'Acme', type: 'Shirts', tags: ['men'],
  options: [{ name: 'Size', position: 1, values: ['M', 'L'] }, { name: 'Color', position: 2, values: ['White'] }],
  variants: [
    { id: 4001, title: 'M / White', option1: 'M', option2: 'White', option3: null, price: 189900, compare_at_price: 249900, available: true, sku: 'LS-M' },
    { id: 4002, title: 'L / White', option1: 'L', option2: 'White', option3: null, price: 189900, compare_at_price: 100, available: false, sku: 'LS-L' },
  ],
  media: [{ alt: 'Front', src: '//cdn.shopify.com/a.jpg', media_type: 'image', width: 1000, height: 1200 }, { src: '//cdn.shopify.com/v.mp4', media_type: 'video' }],
};

describe('Shopify product JSON', () => {
  const s = snapshotFromShopifyJs(shopifyJs, 'https://acme.in/collections/x/products/linen-shirt', 'INR', 'Rs. {{amount}}');
  it('keeps real variant IDs, options and minor-unit prices', () => {
    expect(s.variants.map((v) => v.id)).toEqual([4001, 4002]);
    expect(s.options).toEqual(['Size', 'Color']);
    expect(s.variants[0]).toMatchObject({ options: ['M', 'White'], price: 189900, compareAtPrice: 249900, available: true });
  });
  it('drops compare-at prices that are not higher than price', () => expect(s.variants[1].compareAtPrice).toBeNull());
  it('keeps image media only and makes protocol-relative URLs absolute', () => {
    expect(s.images).toEqual([{ src: 'https://cdn.shopify.com/a.jpg', alt: 'Front', width: 1000, height: 1200 }]);
  });
  it('builds the canonical product URL', () => expect(s.url).toBe('https://acme.in/products/linen-shirt'));
  it('treats Default Title products as having no options', () => {
    const d = snapshotFromShopifyJs({ ...shopifyJs, options: ['Title'], variants: [{ ...shopifyJs.variants[0], title: 'Default Title', option1: 'Default Title', option2: null }] }, 'https://a.in/products/x', 'INR', 'Rs. {{amount}}');
    expect(d.options).toEqual([]);
    expect(d.variants[0].options).toEqual([]);
  });
  it('parses handles from product URLs', () => {
    expect(shopifyHandleFromUrl(new URL('https://a.in/collections/c/products/my-tee?variant=1'))).toBe('my-tee');
    expect(shopifyHandleFromUrl(new URL('https://a.in/products/my-tee.json'))).toBe('my-tee');
    expect(shopifyHandleFromUrl(new URL('https://a.in/pages/about'))).toBeNull();
  });
});

const ldHtml = `<html><head>
<meta property="og:price:currency" content="INR">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"Product","name":"Steel Bottle","brand":{"@type":"Brand","name":"Hydro"},"image":["https://x.in/b.jpg"],
"offers":{"@type":"AggregateOffer","offers":[{"@type":"Offer","price":"599.00","priceCurrency":"INR","sku":"B1","name":"750ml","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"699","priceCurrency":"INR","sku":"B2","name":"1L","availability":"https://schema.org/OutOfStock"}]},
"aggregateRating":{"@type":"AggregateRating","ratingValue":"9.2","bestRating":"10","reviewCount":"41"},
"review":[{"@type":"Review","author":{"@type":"Person","name":"Asha"},"reviewRating":{"ratingValue":5},"reviewBody":"Keeps water cold all day."}]}]}</script>
<script type="application/ld+json">{ broken json </script>
</head><body></body></html>`;

describe('JSON-LD fallback', () => {
  const $ = cheerio.load(ldHtml);
  const ld = jsonLdNodes($);
  const product = ld.find((n) => n['@type'] === 'Product')!;
  it('flattens @graph and ignores malformed blocks', () => expect(ld.length).toBe(2));
  it('builds variants from offers with prices in minor units', () => {
    const s = snapshotFromJsonLd(product, 'https://x.in/p/steel-bottle', 'INR', 'Rs. {{amount}}')!;
    expect(s.variants).toMatchObject([{ id: 'B1', title: '750ml', price: 59900, available: true }, { id: 'B2', price: 69900, available: false }]);
    expect(s.vendor).toBe('Hydro');
  });
  it('normalises ratings to a 5-point scale and keeps real reviews only', () => {
    const r = extractReviews($, ld);
    expect(r.rating).toEqual({ value: 4.6, count: 41, source: expect.stringContaining('JSON-LD') });
    expect(r.reviews).toEqual([{ author: 'Asha', rating: 5, title: undefined, body: 'Keeps water cold all day.', date: undefined }]);
  });
  it('detects currency', () => expect(detectCurrency(ldHtml, $)).toBe('INR'));
});

describe('review widgets', () => {
  it('reads Judge.me badge and reviews; returns nothing when absent', () => {
    const $ = cheerio.load(`<div class="jdgm-prev-badge" data-average-rating="4.80" data-number-of-reviews="230"></div>
      <div class="jdgm-rev" data-score="5"><span class="jdgm-rev__author">Ravi K.</span><div class="jdgm-rev__body"><p>Great fit.</p></div><span class="jdgm-rev__buyer-badge"></span></div>`);
    const r = extractReviews($, []);
    expect(r.rating).toMatchObject({ value: 4.8, count: 230 });
    expect(r.reviews[0]).toMatchObject({ author: 'Ravi K.', rating: 5, body: 'Great fit.', verified: true });
    expect(extractReviews(cheerio.load('<p>No reviews yet</p>'), [])).toEqual({ rating: undefined, reviews: [] });
  });
  it('ignores a widget badge with zero reviews', () => {
    expect(extractReviews(cheerio.load('<div class="jdgm-prev-badge" data-average-rating="0" data-number-of-reviews="0"></div>'), []).rating).toBeUndefined();
  });
});

describe('specs and highlights', () => {
  it('parses tables, label:value bullets, br lines and dl; keeps bullets as highlights', () => {
    const { specs, highlights } = extractSpecs(`
      <table><tr><th>Material</th><td>100% Cotton</td></tr><tr><td>GSM</td><td>180</td></tr></table>
      <ul><li><strong>Fit:</strong> Regular</li><li>Pre-shrunk fabric that keeps its shape</li><li>Care - Machine wash cold</li></ul>
      <p>Country of origin: India<br>Neck: Crew</p>
      <dl><dt>Weight</dt><dd>200 g</dd></dl>
      <p>This is a long marketing sentence that should not be parsed as a spec.</p>`);
    expect(specs.map((s) => [s.label, s.value])).toEqual([
      ['Material', '100% Cotton'], ['GSM', '180'], ['Weight', '200 g'], ['Fit', 'Regular'], ['Care', 'Machine wash cold'], ['Country of origin', 'India'], ['Neck', 'Crew'],
    ]);
    expect(highlights).toEqual(['Pre-shrunk fabric that keeps its shape']);
  });
});

describe('page spec tables', () => {
  it('reads tables/dl in main content but not header/footer', async () => {
    const { extractPageSpecTables } = await import('./specs.js');
    const specs = extractPageSpecTables(`<header><table><tr><td>Menu</td><td>Shop</td></tr></table></header>
      <main><div class="accordion"><table><tr><th>Capacity</th><td>39 L</td></tr><tr><th>Weight</th><td>2.9 kg</td></tr></table></div>
      <p>Warranty: 6 years</p></main><footer><dl><dt>Phone</dt><dd>123</dd></dl></footer>`);
    expect(specs.map((s) => s.label)).toEqual(['Capacity', 'Weight']);
  });
});

describe('claims', () => {
  it('detects positive claims with evidence and ignores negated ones', () => {
    const c = extractClaims('Free shipping on orders above ₹999. Easy 7-day returns. Delivery in 3-5 business days. Made in India.', { isShopify: true });
    expect(c.map((x) => x.id)).toEqual(['returns', 'free_shipping', 'delivery_time', 'made_in_india', 'secure_checkout']);
    expect(c.find((x) => x.id === 'free_shipping')).toMatchObject({ text: 'On orders above ₹999' });
    expect(c.find((x) => x.id === 'returns')).toMatchObject({ title: '7-day returns', evidence: expect.stringContaining('7-day returns') });
    expect(c.find((x) => x.id === 'delivery_time')?.title).toBe('Delivery in 3–5 days');
  });
  it('does not claim COD when the page says it is unavailable', () => {
    expect(extractClaims('Sorry, COD is not available for this pin code.', { isShopify: false })).toEqual([]);
    expect(extractClaims('We do not offer cash on delivery.', { isShopify: false })).toEqual([]);
    expect(extractClaims('Cash on Delivery available', { isShopify: false })[0].id).toBe('cod');
  });
});

describe('misc', () => {
  it('money format falls back by currency', () => {
    expect(detectMoneyFormat('', 'INR')).toBe('Rs. {{amount}}');
    expect(detectMoneyFormat('"money_format":"\\u003cspan\\u003e₹{{amount}}\\u003c/span\\u003e"', 'INR')).toBe('₹{{amount}}');
  });
  it('guesses category', () => {
    expect(guessCategory('Oversized Graphic Tee', '', [])).toBe('apparel/t-shirts');
    expect(guessCategory('Vitamin C Face Serum', 'Skincare', [])).toBe('beauty/skincare');
    expect(guessCategory('Mystery item', 'Gadgets', [])).toBe('other/gadgets');
  });
});
