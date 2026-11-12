/**
 * Product extraction from a public product URL.
 * Order of preference (most to least reliable):
 *   1. Shopify storefront JSON  /products/<handle>.js   (real variant IDs, prices in minor units, options, media)
 *   2. JSON-LD Product in the page HTML                 (name, offers, rating/reviews)
 *   3. DOM / OpenGraph meta                             (title, image, description)
 * Facts that are not found are left empty — never invented. Every fact records its source.
 * Scraped content is treated as untrusted data.
 */
import * as cheerio from 'cheerio';
import type { ProductFacts } from '../catalogue/facts.js';
import type { ProductSnapshot } from '../catalogue/product.js';
import { safeFetch } from '../net/url-guard.js';
import { extractClaims } from './claims.js';
import { extractReviews } from './reviews.js';
import { extractPageSpecTables, extractSpecs } from './specs.js';

export interface ExtractedProduct {
  platform: 'shopify' | 'generic';
  sourceUrl: string;
  finalUrl: string;
  snapshot: ProductSnapshot;
  facts: ProductFacts;
  sources: Record<string, string>;
  warnings: string[];
}

// ---------------- Shopify .js ----------------
interface ShopifyJsVariant {
  id: number; title: string; option1: string | null; option2: string | null; option3: string | null; options?: string[];
  price: number; compare_at_price: number | null; available: boolean; sku?: string | null; barcode?: string | null;
}
interface ShopifyJsProduct {
  id: number; title: string; handle: string; description: string; vendor?: string; type?: string; tags?: string[] | string;
  options: (string | { name: string; position: number; values: string[] })[];
  variants: ShopifyJsVariant[];
  images?: string[];
  media?: { alt?: string | null; src?: string; media_type?: string; width?: number; height?: number; preview_image?: { src: string; width?: number; height?: number } }[];
}

const absUrl = (src: string) => (src.startsWith('//') ? `https:${src}` : src);

export function snapshotFromShopifyJs(p: ShopifyJsProduct, pageUrl: string, currency: string, moneyFormat: string): ProductSnapshot {
  const optionNames = (p.options ?? []).map((o) => (typeof o === 'string' ? o : o.name)).filter(Boolean);
  const onlyDefault = p.variants.length === 1 && (optionNames.length === 0 || (optionNames.length === 1 && optionNames[0] === 'Title' && p.variants[0].title === 'Default Title'));
  const images = (p.media?.length
    ? p.media
        .filter((m) => !m.media_type || m.media_type === 'image')
        .map((m) => ({ src: absUrl(m.src ?? m.preview_image?.src ?? ''), alt: m.alt ?? undefined, width: m.width ?? m.preview_image?.width, height: m.height ?? m.preview_image?.height }))
    : (p.images ?? []).map((src) => ({ src: absUrl(src), alt: undefined, width: undefined, height: undefined }))
  ).filter((i) => i.src);
  return {
    handle: p.handle,
    title: p.title,
    vendor: p.vendor || undefined,
    descriptionHtml: p.description ?? '',
    url: new URL(`/products/${p.handle}`, pageUrl).toString(),
    currency,
    moneyFormat,
    images,
    options: onlyDefault ? [] : optionNames,
    variants: p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      options: onlyDefault ? [] : (v.options ?? [v.option1, v.option2, v.option3].filter((o): o is string => o != null)),
      price: v.price,
      compareAtPrice: v.compare_at_price && v.compare_at_price > v.price ? v.compare_at_price : null,
      available: v.available,
      sku: v.sku || undefined,
      barcode: v.barcode || undefined,
    })),
  };
}

// ---------------- JSON-LD ----------------
type Json = Record<string, unknown>;

export function jsonLdNodes($: cheerio.CheerioAPI): Json[] {
  const out: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text().trim());
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const n = stack.shift();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray((n as Json)['@graph'])) stack.push(...((n as Json)['@graph'] as unknown[]));
        else out.push(n as Json);
      }
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });
  return out;
}

const isType = (n: Json, t: string) => {
  const ty = n['@type'];
  return ty === t || (Array.isArray(ty) && ty.includes(t));
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const toCents = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export function snapshotFromJsonLd(product: Json, pageUrl: string, currencyFallback: string, moneyFormat: string): ProductSnapshot | null {
  const name = str(product.name);
  if (!name) return null;
  const offersRaw = product.offers as Json | Json[] | undefined;
  let offers: Json[] = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
  // AggregateOffer
  if (offers.length === 1 && isType(offers[0], 'AggregateOffer') && Array.isArray(offers[0].offers)) offers = offers[0].offers as Json[];
  const imgs = ([] as unknown[]).concat(product.image ?? []).map((i) => (typeof i === 'string' ? i : str((i as Json)?.url))).filter(Boolean);
  const currency = str(offers[0]?.priceCurrency) || currencyFallback;
  const variants = offers
    .map((o, i) => {
      const price = toCents(o.price ?? o.lowPrice);
      if (price == null) return null;
      return {
        id: str(o.sku) || `offer-${i + 1}`,
        title: str(o.name) || (offers.length > 1 ? `Option ${i + 1}` : 'Default Title'),
        options: [] as string[],
        price,
        compareAtPrice: null,
        available: !/OutOfStock|SoldOut|Discontinued/i.test(str(o.availability)),
        sku: str(o.sku) || undefined,
        barcode: str(o.gtin13 || o.gtin12 || o.gtin || o.gtin14 || o.gtin8) || undefined,
      };
    })
    .filter((v): v is NonNullable<typeof v> => !!v);
  if (!variants.length) return null;
  const url = new URL(pageUrl);
  return {
    handle: url.pathname.split('/').filter(Boolean).pop() ?? 'product',
    title: name,
    vendor: str((product.brand as Json)?.name ?? product.brand) || undefined,
    descriptionHtml: str(product.description) ? `<p>${str(product.description)}</p>` : '',
    url: pageUrl,
    currency,
    moneyFormat,
    images: imgs.map((src) => ({ src: absUrl(src), alt: undefined, width: undefined, height: undefined })),
    options: [],
    variants,
  };
}

// ---------------- page meta ----------------
const MONEY_FORMATS: Record<string, string> = { INR: 'Rs. {{amount}}', USD: '${{amount}}', EUR: '€{{amount}}', GBP: '£{{amount}}', AUD: '${{amount}}', CAD: '${{amount}}', AED: 'Dhs. {{amount}}' };

export function detectCurrency(html: string, $: cheerio.CheerioAPI): string {
  return (
    html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ||
    $('meta[property="og:price:currency"], meta[property="product:price:currency"]').attr('content')?.trim() ||
    html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/)?.[1] ||
    'INR'
  );
}

export function detectMoneyFormat(html: string, currency: string): string {
  const m = html.match(/"money_format"\s*:\s*"([^"]{1,120})"/) ?? html.match(/moneyFormat\s*[:=]\s*["']([^"']{1,120})["']/);
  const raw = m?.[1]?.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\\//g, '/');
  return raw && raw.includes('{{') ? raw.replace(/<[^>]*>/g, '') : MONEY_FORMATS[currency] ?? `${currency} {{amount}}`;
}

export function shopifyHandleFromUrl(u: URL): string | null {
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).replace(/\.(js|json|oembed)$/, '') : null;
}

const htmlToText = (html: string) => cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();

// ---------------- main ----------------
export async function extractProduct(rawUrl: string): Promise<ExtractedProduct> {
  const warnings: string[] = [];
  const sources: Record<string, string> = {};
  const page = await safeFetch(rawUrl, { accept: 'text/html' });
  if (!page.ok) throw new Error(`Product page returned HTTP ${page.status}`);
  if (!/html/i.test(page.contentType)) throw new Error(`Expected an HTML page, got ${page.contentType || 'unknown content type'}`);
  const html = page.text();
  const $ = cheerio.load(html);
  const finalUrl = new URL(page.url);
  const currency = detectCurrency(html, $);
  const moneyFormat = detectMoneyFormat(html, currency);
  const ld = jsonLdNodes($);
  const ldProduct = ld.find((n) => isType(n, 'Product') || isType(n, 'ProductGroup'));

  let snapshot: ProductSnapshot | null = null;
  let platform: ExtractedProduct['platform'] = 'generic';
  let productType = '';
  let tags: string[] = [];

  const isShopify = /cdn\.shopify\.com|Shopify\.shop\s*=|shopify-features|myshopify\.com/i.test(html);
  const handle = shopifyHandleFromUrl(finalUrl);
  if (isShopify && handle) {
    try {
      const js = await safeFetch(new URL(`/products/${encodeURIComponent(handle)}.js`, finalUrl.origin).toString(), { accept: 'application/json' });
      if (js.ok) {
        const p = js.json<ShopifyJsProduct>();
        snapshot = snapshotFromShopifyJs(p, finalUrl.toString(), currency, moneyFormat);
        platform = 'shopify';
        productType = p.type ?? '';
        tags = Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
        sources.product = 'Shopify storefront JSON (/products/<handle>.js)';
        sources.variants = 'Shopify storefront JSON — real variant IDs';
      } else warnings.push(`Shopify product JSON unavailable (HTTP ${js.status}); fell back to page data.`);
    } catch (e) {
      warnings.push(`Shopify product JSON failed: ${(e as Error).message}`);
    }
  }
  if (!snapshot && ldProduct) {
    snapshot = snapshotFromJsonLd(ldProduct, finalUrl.toString(), currency, moneyFormat);
    if (snapshot) {
      sources.product = 'JSON-LD Product on the page';
      sources.variants = 'JSON-LD offers (no store variant IDs available)';
      warnings.push('Variant IDs come from JSON-LD, not a Shopify store; import the product to your store to get real IDs.');
    }
  }
  if (!snapshot) {
    const title = $('meta[property="og:title"]').attr('content')?.trim() || $('h1').first().text().trim();
    const priceMeta = $('meta[property="og:price:amount"], meta[property="product:price:amount"]').attr('content');
    const price = toCents(priceMeta);
    if (!title || price == null) throw new Error('Could not find product data (no Shopify JSON, JSON-LD Product or price meta tags).');
    snapshot = {
      handle: handle ?? 'product', title, vendor: $('meta[property="og:site_name"]').attr('content')?.trim(),
      descriptionHtml: $('meta[property="og:description"]').attr('content') ? `<p>${$('meta[property="og:description"]').attr('content')}</p>` : '',
      url: finalUrl.toString(), currency, moneyFormat,
      images: $('meta[property="og:image"]').map((_, el) => ({ src: absUrl($(el).attr('content') ?? ''), alt: undefined, width: undefined, height: undefined })).get().filter((i) => i.src),
      options: [], variants: [{ id: 'default', title: 'Default Title', options: [], price, compareAtPrice: null, available: true }],
    };
    sources.product = 'OpenGraph meta tags';
    warnings.push('Only basic meta tags were found; variants and specs may be incomplete.');
  }

  // collection (first product-collection link on the page, if any)
  const colLink = $('a[href*="/collections/"]').filter((_, el) => !/\/collections\/(all|frontpage)\b/.test($(el).attr('href') ?? '')).first();
  if (colLink.length) {
    const href = colLink.attr('href')!;
    const t = colLink.text().replace(/\s+/g, ' ').trim();
    if (t && t.length <= 60) snapshot.collection = { title: t, url: new URL(href, finalUrl).pathname };
  }

  // ---------------- facts ----------------
  const specsResult = extractSpecs(snapshot.descriptionHtml);
  if (specsResult.specs.length < 3) {
    const known = new Set(specsResult.specs.map((s) => s.label.toLowerCase()));
    const pageSpecs = extractPageSpecTables(html).filter((s) => !known.has(s.label.toLowerCase()));
    if (pageSpecs.length) {
      specsResult.specs.push(...pageSpecs.slice(0, 25 - specsResult.specs.length));
      sources.specs = 'Product description + spec tables on the product page';
    }
  }
  const reviews = extractReviews($, ld);
  const pageText = $('body').clone().find('script,style,noscript,svg').remove().end().text().replace(/\s+/g, ' ');
  const claims = extractClaims(pageText, { isShopify: platform === 'shopify' || isShopify });
  if (specsResult.specs.length && !sources.specs) sources.specs = 'Product description';
  if (reviews.rating) sources.rating = reviews.rating.source;

  const brandName = snapshot.vendor || $('meta[property="og:site_name"]').attr('content')?.trim() || finalUrl.hostname.replace(/^www\./, '');
  const hasCompareAt = snapshot.variants.some((v) => v.compareAtPrice && v.compareAtPrice > v.price);
  const facts: ProductFacts = {
    title: snapshot.title,
    vendor: snapshot.vendor,
    brandName,
    category: guessCategory(snapshot.title, productType, tags),
    descriptionText: htmlToText(snapshot.descriptionHtml).slice(0, 4000),
    hasCompareAt,
    rating: reviews.rating,
    reviews: reviews.reviews,
    specs: specsResult.specs,
    highlights: specsResult.highlights,
    claims,
    offer: undefined, // offers are only taken from explicit merchant input (dashboard), never inferred
  };
  if (!snapshot.images.length) warnings.push('No product images found.');
  if (!reviews.rating && !reviews.reviews.length) warnings.push('No reviews or rating found on the page; review sections will be omitted.');

  return { platform, sourceUrl: rawUrl, finalUrl: finalUrl.toString(), snapshot, facts, sources, warnings };
}

// ---------------- category ----------------
const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(t-?shirts?|tees?)\b/i, 'apparel/t-shirts'],
  [/\b(shirts?|polos?)\b/i, 'apparel/shirts'],
  [/\b(hoodies?|sweatshirts?|jackets?)\b/i, 'apparel/outerwear'],
  [/\b(kurtas?|kurtis?|sarees?|lehengas?)\b/i, 'apparel/ethnic'],
  [/\b(dress(es)?|tops?|skirts?)\b/i, 'apparel/womenswear'],
  [/\b(jeans|trousers|pants|joggers|shorts|chinos)\b/i, 'apparel/bottoms'],
  [/\b(sneakers?|shoes?|sandals?|slides?|loafers?|boots?)\b/i, 'footwear'],
  [/\b(backpacks?|bags?|totes?|wallets?|luggage|suitcases?|trolley)\b/i, 'accessories/bags'],
  [/\b(watch(es)?|sunglasses|belts?|caps?|hats?|jewell?ery|rings?|necklaces?)\b/i, 'accessories'],
  [/\b(serum|moisturi[sz]er|sunscreen|face ?wash|cleanser|lipstick|shampoo|conditioner|skincare|toner)\b/i, 'beauty/skincare'],
  [/\b(earbuds|headphones|speakers?|chargers?|power ?bank|smart ?watch)\b/i, 'electronics/audio'],
  [/\b(coffee|tea|snacks?|protein|peanut butter|granola|muesli|chocolate)\b/i, 'food/beverage'],
  [/\b(mugs?|bottles?|candles?|bedsheets?|cushions?|decor)\b/i, 'home'],
];

export function guessCategory(title: string, productType: string, tags: string[]): string {
  const hay = [productType, title, ...tags].join(' | ');
  for (const [re, cat] of CATEGORY_RULES) if (re.test(hay)) return cat;
  return productType ? `other/${productType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'other';
}
