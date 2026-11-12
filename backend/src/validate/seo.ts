/**
 * SEO / AEO / GEO checklist computed from the rendered page + facts (never from an LLM's opinion).
 * Statuses: passed | failed | needs_verification | not_applicable. Scores count only passed vs failed.
 * Items that depend on the Shopify theme layout (meta title/description, canonical) are marked
 * needs_verification here and confirmed on the Shopify preview.
 */
import * as cheerio from 'cheerio';
import { isUnbackedPolicyQuestion, type ProductFacts } from '../catalogue/facts.js';

export type CheckStatus = 'passed' | 'failed' | 'needs_verification' | 'not_applicable';
export interface CheckItem { id: string; area: 'seo' | 'aeo' | 'geo' | 'schema'; label: string; status: CheckStatus; detail: string }
export interface Checklist { items: CheckItem[]; scores: Record<'seo' | 'aeo' | 'geo' | 'schema', { passed: number; failed: number; total: number; score: number | null }> }

const VAGUE = ['best in class', 'world-class', 'world class', 'revolutionary', 'game changer', 'game-changer', 'unmatched', 'second to none', 'like never before', 'ultimate', 'number one', '#1', 'perfect for everyone', 'unbeatable'];

type Json = Record<string, unknown>;
function jsonLd($: cheerio.CheerioAPI): { nodes: Json[]; errors: string[] } {
  const nodes: Json[] = [];
  const errors: string[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const d = JSON.parse($(el).contents().text());
      for (const n of Array.isArray(d) ? d : [d]) nodes.push(n);
    } catch (e) {
      errors.push(`JSON-LD block ${i + 1} is not valid JSON: ${(e as Error).message}`);
    }
  });
  return { nodes, errors };
}

export function runChecklist(html: string, facts: ProductFacts, ctx: { handle: string; hasCollection: boolean; unsupportedNumbers: string[]; brandName: string }): Checklist {
  const $ = cheerio.load(html);
  const items: CheckItem[] = [];
  const add = (id: string, area: CheckItem['area'], label: string, status: CheckStatus, detail: string) => items.push({ id, area, label, status, detail });
  const main = $('#MainContent').length ? $('#MainContent') : $('body');
  // visible text only (section <style>/<script>/JSON-LD would otherwise leak "#1A1A1A" etc.)
  const text = main.clone().find('style,script,noscript').remove().end().text().replace(/\s+/g, ' ');

  // ---------------- SEO ----------------
  const h1 = main.find('h1');
  add('one_h1', 'seo', 'Exactly one H1', h1.length === 1 ? 'passed' : 'failed', `${h1.length} H1 heading(s) found`);
  const levels = main.find('h1,h2,h3,h4,h5,h6').map((_, e) => Number(e.tagName.slice(1))).get();
  const skips = levels.filter((l, i) => i > 0 && l - levels[i - 1] > 1).length;
  add('heading_order', 'seo', 'Logical heading order (no skipped levels)', skips === 0 && levels[0] === 1 ? 'passed' : 'failed', skips ? `${skips} place(s) skip a heading level` : levels[0] !== 1 ? 'Page does not start with the H1' : `${levels.length} headings in order`);
  // Decorative images (alt="" next to the same text, e.g. the sticky-bar thumbnail) are correct a11y practice.
  const imgs = main.find('img').not('.lp-sticky__thumb');
  const noAlt = imgs.filter((_, e) => !$(e).attr('alt')?.trim()).length;
  const fileAlt = imgs.filter((_, e) => /\.(jpe?g|png|webp)$|^img_?\d+$/i.test($(e).attr('alt') ?? '')).length;
  add('img_alt', 'seo', 'Descriptive alt text on all images', noAlt + fileAlt === 0 ? 'passed' : 'failed', `${imgs.length} images, ${noAlt} without alt, ${fileAlt} with file-name alt`);
  const lazyBelow = imgs.slice(2).filter((_, e) => $(e).attr('loading') !== 'lazy').length;
  add('lazy_images', 'seo', 'Images below the first screen are lazy-loaded', lazyBelow === 0 ? 'passed' : 'failed', `${lazyBelow} below-the-fold image(s) load eagerly`);
  const sized = imgs.filter((_, e) => !!$(e).attr('width') && !!$(e).attr('height') && !!$(e).attr('srcset')).length;
  add('img_sizes', 'seo', 'Responsive images (srcset, width, height)', imgs.length && sized === imgs.length ? 'passed' : imgs.length ? 'failed' : 'not_applicable', `${sized} of ${imgs.length} images have srcset and dimensions`);
  const collectionLink = main.find('a[href*="/collections/"]').length > 0;
  add('internal_link', 'seo', 'Internal link to the product collection', collectionLink ? 'passed' : ctx.hasCollection ? 'failed' : 'needs_verification', collectionLink ? 'Breadcrumb links to the collection' : 'Product is not in a collection yet — add it to one in Shopify so the breadcrumb links to it');
  add('handle', 'seo', 'Readable URL handle', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ctx.handle) && ctx.handle.length <= 80 ? 'passed' : 'failed', `/products/${ctx.handle}`);
  add('meta_title', 'seo', 'Meta title and description', 'needs_verification', 'Rendered by the theme layout from the product SEO fields; confirm on the Shopify preview');
  add('canonical', 'seo', 'Canonical URL', 'needs_verification', 'Rendered by the theme layout (canonical_url); confirm on the Shopify preview');

  // ---------------- structured data ----------------
  const { nodes, errors } = jsonLd($);
  add('jsonld_parse', 'schema', 'Structured data is valid JSON', errors.length ? 'failed' : nodes.length ? 'passed' : 'failed', errors[0] ?? `${nodes.length} JSON-LD block(s)`);
  const product = nodes.find((n) => n['@type'] === 'Product');
  if (!product) add('product_schema', 'schema', 'Product schema', 'failed', 'No Product JSON-LD found');
  else {
    const offers = ([] as Json[]).concat((product.offers as Json | Json[]) ?? []);
    const missing = ['name', 'image', 'brand'].filter((k) => !product[k]);
    const offerOk = offers.length > 0 && offers.every((o) => typeof o.price === 'number' && o.priceCurrency && String(o.availability ?? '').startsWith('https://schema.org/'));
    add('product_schema', 'schema', 'Product schema with price, currency and availability', !missing.length && offerOk ? 'passed' : 'failed', missing.length ? `Missing: ${missing.join(', ')}` : offerOk ? `${offers.length} offer(s), one per variant` : 'Offers missing price/currency/availability');
    const visibleRating = main.find('.lp-rating, .lp-reviews__summary').length > 0;
    const hasRatingSchema = !!product.aggregateRating;
    add('rating_truthful', 'schema', 'Rating in schema only when real and visible', hasRatingSchema === visibleRating && (!hasRatingSchema || !!facts.rating) ? 'passed' : 'failed', hasRatingSchema ? `aggregateRating ${String((product.aggregateRating as Json).ratingValue)} from the source page` : facts.rating ? 'Real rating exists but is not shown, so it is left out of the schema' : 'No real rating, so none is claimed');
    add('brand_consistent', 'geo', 'Brand name used consistently', String((product.brand as Json)?.name ?? '').toLowerCase() === ctx.brandName.toLowerCase() ? 'passed' : 'failed', `Schema brand: ${String((product.brand as Json)?.name ?? '—')}`);
  }
  const faqNode = nodes.find((n) => n['@type'] === 'FAQPage');
  const visibleQs = main.find('.lp-faq summary').map((_, e) => $(e).text().trim()).get();

  // ---------------- AEO ----------------
  if (!visibleQs.length) {
    add('faq_present', 'aeo', 'FAQ with direct answers', 'failed', 'No FAQ section on the page');
  } else {
    add('faq_present', 'aeo', 'FAQ with direct answers', visibleQs.length >= 3 ? 'passed' : 'failed', `${visibleQs.length} questions`);
    const schemaQs = ((faqNode?.mainEntity as Json[]) ?? []).map((q) => String(q.name).trim());
    const match = schemaQs.length === visibleQs.length && schemaQs.every((q, i) => q === visibleQs[i]);
    add('faq_schema', 'schema', 'FAQPage schema matches the visible questions', faqNode ? (match ? 'passed' : 'failed') : 'failed', faqNode ? (match ? `${schemaQs.length} questions in both` : 'Schema and page questions differ') : 'No FAQPage JSON-LD');
    const answers = main.find('.lp-faq__a').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();
    const short = answers.filter((a) => a.split(' ').length < 6).length;
    const long = answers.filter((a) => a.split(' ').length > 70).length;
    add('faq_standalone', 'aeo', 'Answers are short and make sense on their own', short + long === 0 ? 'passed' : 'failed', `${answers.length} answers; ${short} too short, ${long} too long`);
    const topics: [string, RegExp][] = [['size/fit', /size|fit/i], ['material', /material|fabric|made (of|from)|cotton|polyester|ingredient/i], ['care', /wash|care|clean|store/i], ['delivery', /deliver|ship/i], ['returns', /return|exchange/i]];
    const covered = topics.filter(([, re]) => visibleQs.some((q) => re.test(q))).map(([t]) => t);
    add('faq_topics', 'aeo', 'Covers questions shoppers search for', covered.length >= 3 ? 'passed' : 'needs_verification', `Covers: ${covered.join(', ') || 'none'}${covered.length < 5 ? `; missing: ${topics.map(([t]) => t).filter((t) => !covered.includes(t)).join(', ')}` : ''}`);
    // policy answers must be backed by confirmed claims
    const claimIds = new Set(facts.claims.map((c) => c.id));
    const unbacked: string[] = [];
    visibleQs.forEach((q) => { if (isUnbackedPolicyQuestion(q, claimIds)) unbacked.push(q); });
    add('faq_policies', 'aeo', 'Delivery, COD and returns answers match confirmed store promises', unbacked.length ? 'failed' : 'passed', unbacked.length ? `Not backed by a confirmed promise: ${[...new Set(unbacked)].join(' | ')}` : 'Every policy answer is backed by a confirmed promise');
  }

  // ---------------- GEO ----------------
  const specRows = main.find('.lp-specs__table tr').length;
  add('specs_table', 'geo', 'Quotable specifications table', specRows >= 3 ? 'passed' : facts.specs.length >= 3 ? 'failed' : 'needs_verification', specRows ? `${specRows} spec rows` : facts.specs.length ? 'Specs exist but are not on this page' : 'The source page has no structured specs — add materials and dimensions in Shopify');
  const hasMaterial = facts.specs.some((s) => /material|fabric|composition|ingredient|made of|shell|lining/i.test(s.label)) || /\b(cotton|polyester|leather|steel|aluminium|polycarbonate|wool|linen|nylon|ingredients?)\b/i.test(text);
  add('materials', 'geo', 'Materials stated as facts', hasMaterial ? 'passed' : 'needs_verification', hasMaterial ? 'Material is stated' : 'No material found in the product data');
  const hasDims = facts.specs.some((s) => /dimension|size|weight|capacity|length|width|height|gsm|volume|ml|litre/i.test(s.label + ' ' + s.value));
  add('dimensions', 'geo', 'Dimensions / size / weight stated', hasDims ? 'passed' : 'needs_verification', hasDims ? 'Measurable facts present' : 'No dimensions or weight in the product data');
  add('who_for', 'geo', 'Says who it is for', /\bfor (everyday|men|women|kids|travel|work|daily|anyone|people|frequent|those)\b|who it'?s for/i.test(text) ? 'passed' : 'needs_verification', 'Plain statement of the intended user or use');
  const vague = VAGUE.filter((v) => text.toLowerCase().includes(v));
  add('no_vague', 'geo', 'No vague marketing claims without facts', vague.length ? 'failed' : 'passed', vague.length ? `Found: ${vague.join(', ')}` : 'None found');
  add('numbers_supported', 'geo', 'Every number in the copy comes from product data', ctx.unsupportedNumbers.length ? 'failed' : 'passed', ctx.unsupportedNumbers.length ? `Unsupported: ${ctx.unsupportedNumbers.join(', ')}` : 'All figures trace back to the source page');

  const scores = {} as Checklist['scores'];
  for (const area of ['seo', 'aeo', 'geo', 'schema'] as const) {
    const a = items.filter((i) => i.area === area);
    const passed = a.filter((i) => i.status === 'passed').length;
    const failed = a.filter((i) => i.status === 'failed').length;
    scores[area] = { passed, failed, total: a.length, score: passed + failed ? Math.round((passed / (passed + failed)) * 100) : null };
  }
  return { items, scores };
}
