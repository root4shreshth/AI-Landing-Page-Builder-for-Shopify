/**
 * Reviews and rating — ONLY when genuinely present on the source page (JSON-LD or a known review widget's
 * server-rendered markup). Never synthesised. Each result names its source.
 */
import type * as cheerio from 'cheerio';
import type { ProductFacts } from '../catalogue/facts.js';

type Json = Record<string, unknown>;
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function extractReviews($: cheerio.CheerioAPI, ld: Json[], productTitle = ''): { rating?: ProductFacts['rating']; reviews: ProductFacts['reviews'] } {
  // Many review apps put the product name in the review "title" field; that is not a real title.
  const realTitle = (t: string) => (t && t.toLowerCase() !== productTitle.toLowerCase() ? t.slice(0, 120) : undefined);
  const reviews: ProductFacts['reviews'] = [];
  let rating: ProductFacts['rating'];

  // 1) JSON-LD aggregateRating + reviews on a Product node
  for (const n of ld) {
    const agg = n.aggregateRating as Json | undefined;
    if (agg && !rating) {
      const value = num(agg.ratingValue);
      const count = num(agg.reviewCount ?? agg.ratingCount);
      const best = num(agg.bestRating) ?? 5;
      if (value != null && count && count > 0) rating = { value: Math.round((value / best) * 5 * 10) / 10, count: Math.round(count), source: 'Structured data (JSON-LD) on the source page' };
    }
    const list = ([] as unknown[]).concat(n.review ?? []) as Json[];
    for (const r of list) {
      const body = str(r.reviewBody ?? r.description);
      const author = str((r.author as Json)?.name ?? r.author);
      if (!body || !author) continue;
      // star-only reviews: some apps put the product name in reviewBody when there is no written text
      if (productTitle && body.toLowerCase() === productTitle.toLowerCase()) continue;
      reviews.push({
        author: author.slice(0, 60),
        rating: num((r.reviewRating as Json)?.ratingValue) ?? undefined,
        title: realTitle(str(r.name)),
        body: body.slice(0, 1200),
        date: str(r.datePublished).slice(0, 40) || undefined,
      });
    }
  }

  // 2) Judge.me (server-rendered badge + reviews)
  if (!rating) {
    const badge = $('.jdgm-prev-badge[data-average-rating]').first();
    const value = num(badge.attr('data-average-rating'));
    const count = num(badge.attr('data-number-of-reviews'));
    if (value && count && count > 0) rating = { value, count, source: 'Judge.me review widget on the source page' };
  }
  $('.jdgm-rev').each((_, el) => {
    if (reviews.length >= 12) return;
    const $el = $(el);
    const body = str($el.find('.jdgm-rev__body').text());
    const author = str($el.find('.jdgm-rev__author').text());
    if (!body || !author) return;
    reviews.push({
      author: author.slice(0, 60),
      rating: num($el.attr('data-score') ?? $el.find('[data-score]').attr('data-score')) ?? undefined,
      title: str($el.find('.jdgm-rev__title').text()).slice(0, 120) || undefined,
      body: body.slice(0, 1200),
      date: str($el.find('.jdgm-rev__timestamp').attr('data-content') ?? '').slice(0, 40) || undefined,
      verified: $el.find('.jdgm-rev__buyer-badge').length > 0 || undefined,
    });
  });

  // 3) Loox badge
  if (!rating) {
    const loox = $('.loox-rating[data-rating]').first();
    const value = num(loox.attr('data-rating'));
    const count = num(loox.attr('data-raters'));
    if (value && count && count > 0) rating = { value, count, source: 'Loox review widget on the source page' };
  }

  // de-duplicate reviews (JSON-LD and widget markup often repeat)
  const seen = new Set<string>();
  const unique = reviews.filter((r) => {
    const k = `${r.author}|${r.body.slice(0, 60)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { rating, reviews: unique.slice(0, 12) };
}
