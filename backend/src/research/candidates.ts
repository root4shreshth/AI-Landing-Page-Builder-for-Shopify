/**
 * Competitor candidate selection: queries from the product, filtering (no marketplaces, social, media,
 * or the brand itself), deterministic relevance scoring with a written rationale, one page per domain,
 * and resolving brand home/collection pages to a matching product page (Shopify /products.json).
 */
import type { ProductFacts } from '../catalogue/facts.js';
import { checkRobots } from '../net/robots.js';
import { safeFetch } from '../net/url-guard.js';
import { webSearch, type SearchResult } from './search.js';
import { seedSitesFor } from './seeds.js';

export interface Candidate {
  url: string;
  domain: string;
  title: string;
  relevance: number; // 0..1
  isIndianD2C: boolean;
  rationale: string;
  source: 'search' | 'manual';
  pageType: 'product' | 'collection' | 'home' | 'other';
}

const BLOCKED = [
  // marketplaces & aggregators
  'amazon.', 'flipkart.', 'myntra.', 'ajio.', 'nykaa.', 'nykaafashion.', 'meesho.', 'tatacliq.', 'jiomart.', 'snapdeal.', 'shopclues.', 'paytmmall.', 'firstcry.', 'purplle.', 'bigbasket.', 'blinkit.', 'zeptonow.', 'swiggy.', 'croma.', 'reliancedigital.', 'ebay.', 'walmart.', 'etsy.', 'aliexpress.', 'alibaba.', 'indiamart.', 'tradeindia.', 'smartprix.', 'pricehistory.', 'mysmartprice.', '91mobiles.',
  // social, video, forums, reference, news, blogs
  'instagram.', 'facebook.', 'youtube.', 'youtu.be', 'pinterest.', 'reddit.', 'quora.', 'twitter.', 'x.com', 'linkedin.', 'threads.net', 'tiktok.', 'wikipedia.', 'medium.com', 'blogspot.', 'wordpress.com', 'substack.', 'ndtv.', 'timesofindia.', 'indiatimes.', 'hindustantimes.', 'thehindu.', 'livemint.', 'economictimes.', 'business-standard.', 'forbes.', 'gq', 'vogue.', 'cosmopolitan.', 'elle.', 'buzzfeed.', 'news18.', 'zeebiz.', 'yourstory.', 'inc42.', 'trustpilot.', 'mouthshut.', 'justdial.', 'google.', 'bing.', 'apple.com',
];

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'pack', 'set', 'new', 'edition', 'special', 'pro', 'max', 'plus', 'v1', 'v2', 'mini', 'men', 'women', 'unisex', 'of', 'in', 'a', 'an', 'by', 'to', 'buy', 'online', 'india']);

export const registrableDomain = (host: string) => {
  const h = host.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  // co.in / com.au style second-level suffixes
  if (parts.length > 2 && /^(co|com|net|org)$/.test(parts[parts.length - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
};

export function keywordsFor(facts: ProductFacts): string[] {
  const brandWords = new Set((facts.brandName + ' ' + (facts.vendor ?? '')).toLowerCase().split(/\W+/));
  const words = facts.title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !brandWords.has(w));
  const catWords = (facts.category ?? '').split(/[/-]/).filter((w) => w.length > 2 && w !== 'other' && w !== 'accessories');
  return [...new Set([...words.slice(0, 4), ...catWords].map(stem))].slice(0, 6);
}

/** Crude singular stem so "bags" matches "bag", "serums" matches "serum" (substring matching does the rest). */
export const stem = (w: string) => (w.length > 3 && /[^su]s$/.test(w) ? w.slice(0, -1) : w);

export function buildQueries(facts: ProductFacts): string[] {
  const kw = keywordsFor(facts);
  const core = kw.slice(0, 3).join(' ') || (facts.category ?? 'product').replace(/[/-]/g, ' ');
  const leaf = (facts.category ?? '').split('/').pop()?.replace(/-/g, ' ') || core;
  return [...new Set([`${core} brand india buy online`, `best ${leaf} brands india d2c`, `${core} online india`])];
}

export function pageTypeOf(u: URL): Candidate['pageType'] {
  const p = u.pathname.toLowerCase();
  if (/\/products?\/|\/p\/|\/dp\/|\/item\//.test(p)) return 'product';
  if (/\/collections?\/|\/category\/|\/categories\/|\/shop\//.test(p)) return 'collection';
  if (p === '/' || p === '') return 'home';
  return 'other';
}

export function scoreResult(r: SearchResult, kw: string[]): { relevance: number; isIndian: boolean; reasons: string[] } {
  const u = new URL(r.url);
  const hay = `${r.title} ${r.snippet} ${u.pathname}`.toLowerCase();
  const matched = kw.filter((k) => hay.includes(k));
  const overlap = kw.length ? matched.length / kw.length : 0;
  const type = pageTypeOf(u);
  const isIndian = /\.(in|co\.in)$/.test(u.hostname) || /\bindia\b|₹|\brs\.?\s?\d|\binr\b/i.test(`${r.title} ${r.snippet}`);
  const rank = Math.max(0, 1 - (r.position - 1) / 20);
  const relevance = Math.round((0.45 * overlap + (type === 'product' ? 0.25 : type === 'collection' ? 0.12 : 0.05) + (isIndian ? 0.15 : 0) + 0.15 * rank) * 100) / 100;
  const reasons = [`ranked #${r.position} for "${r.query}" (${r.provider})`];
  if (matched.length) reasons.push(`matches ${matched.map((m) => `"${m}"`).join(', ')}`);
  reasons.push(type === 'product' ? 'product page' : `${type} page`);
  if (isIndian) reasons.push('Indian D2C signal (.in domain, ₹ pricing or India in listing)');
  return { relevance, isIndian, reasons };
}

const blocked = (host: string) => BLOCKED.some((b) => host.includes(b));

/** For a Shopify brand site, find its product that best matches the keywords via /products.json. */
export async function resolveProductPage(origin: string, kw: string[]): Promise<string | null> {
  const listUrl = `${origin}/products.json?limit=250`;
  if (!(await checkRobots(listUrl)).allowed) return null;
  try {
    const res = await safeFetch(listUrl, { accept: 'application/json', timeoutMs: 12_000, maxBytes: 8 * 1024 * 1024 });
    if (!res.ok || !/json/.test(res.contentType)) return null;
    const { products } = res.json<{ products: { handle: string; title: string; product_type?: string; tags?: string[] }[] }>();
    let best: { handle: string; score: number } | null = null;
    const minScore = Math.max(1, Math.ceil(kw.length / 2));
    for (const p of products ?? []) {
      // title matches count double: tags are often broad ("travel", "luggage") and less specific
      const title = p.title.toLowerCase();
      const meta = `${p.product_type ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase();
      const score = kw.reduce((s, k) => s + (title.includes(k) ? 2 : meta.includes(k) ? 1 : 0), 0) / 2;
      if (score >= minScore && (!best || score > best.score)) best = { handle: p.handle, score };
    }
    return best ? `${origin}/products/${best.handle}` : null;
  } catch {
    return null;
  }
}

export async function discoverCandidates(facts: ProductFacts, ownUrl: string, opts: { manualUrls?: string[]; target?: number } = {}): Promise<{ candidates: Candidate[]; queries: string[]; notes: string[] }> {
  const target = opts.target ?? 10;
  const notes: string[] = [];
  const ownDomain = registrableDomain(new URL(ownUrl).hostname);
  const brandSlug = facts.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const seen = new Set<string>([ownDomain]);
  const out: Candidate[] = [];

  for (const raw of opts.manualUrls ?? []) {
    try {
      const u = new URL(raw);
      const d = registrableDomain(u.hostname);
      if (seen.has(d)) continue;
      seen.add(d);
      out.push({ url: u.toString(), domain: d, title: u.hostname, relevance: 1, isIndianD2C: /\.in$/.test(u.hostname), rationale: 'Added by you', source: 'manual', pageType: pageTypeOf(u) });
    } catch {
      notes.push(`Ignored invalid competitor URL: ${raw}`);
    }
  }

  const queries = buildQueries(facts);
  const kw = keywordsFor(facts);
  const results: SearchResult[] = [];
  for (const q of queries) {
    try {
      results.push(...(await webSearch(q, 10)));
    } catch (e) {
      notes.push(`Search failed for "${q}": ${(e as Error).message}`);
    }
  }
  if (!results.length) {
    const seeds = seedSitesFor(facts.category, facts.title);
    if (seeds.length) {
      notes.push(`Search unavailable — using the starter list of Indian D2C brand sites for "${facts.category}". Add your own competitor URLs for better relevance.`);
      for (const site of seeds) {
        if (out.length >= target) break;
        const u = new URL(site);
        const domain = registrableDomain(u.hostname);
        if (seen.has(domain) || (brandSlug && u.hostname.replace(/[^a-z0-9]/g, '').includes(brandSlug))) continue;
        seen.add(domain);
        const resolved = await resolveProductPage(u.origin, kw);
        if (!resolved) {
          notes.push(`${u.hostname}: no product matching ${kw.map((k) => `"${k}"`).join(', ')} — skipped`);
          continue;
        }
        out.push({
          url: resolved ?? u.toString(),
          domain,
          title: u.hostname,
          relevance: resolved ? 0.5 : 0.3,
          isIndianD2C: true,
          rationale: `Starter list for "${facts.category}" (search unavailable)${resolved ? '; resolved to a matching product page' : '; no matching product found, using the home page'}`,
          source: 'search',
          pageType: resolved ? 'product' : 'home',
        });
      }
    } else if (!out.length) notes.push('No search results and no starter list for this category — add competitor URLs manually.');
  }

  const scored = results
    .filter((r) => /^https?:/.test(r.url))
    .map((r) => ({ r, host: new URL(r.url).hostname.toLowerCase() }))
    .filter(({ host }) => !blocked(host))
    .filter(({ host }) => !brandSlug || !host.replace(/[^a-z0-9]/g, '').includes(brandSlug))
    .map(({ r, host }) => ({ r, host, ...scoreResult(r, kw) }))
    .sort((a, b) => b.relevance - a.relevance);

  for (const s of scored) {
    if (out.length >= target) break;
    const domain = registrableDomain(s.host);
    if (seen.has(domain)) continue;
    seen.add(domain);
    let url = s.r.url;
    let pageType = pageTypeOf(new URL(url));
    const reasons = [...s.reasons];
    if (pageType !== 'product') {
      const resolved = await resolveProductPage(new URL(url).origin, kw);
      if (resolved) {
        url = resolved;
        pageType = 'product';
        reasons.push('resolved to a matching product page on the same site');
      }
    }
    out.push({ url, domain, title: s.r.title.slice(0, 120), relevance: s.relevance, isIndianD2C: s.isIndian, rationale: reasons.join('; '), source: 'search', pageType });
  }
  // Prefer Indian D2C brands where available while keeping relevance order inside each group
  out.sort((a, b) => (a.source === 'manual' ? -1 : 0) - (b.source === 'manual' ? -1 : 0) || Number(b.isIndianD2C) - Number(a.isIndianD2C) || b.relevance - a.relevance);
  return { candidates: out, queries, notes };
}
