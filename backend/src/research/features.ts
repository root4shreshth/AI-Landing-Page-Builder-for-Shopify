/**
 * Pure mapping from measured page signals to named, comparable features (what the learnings count).
 * Each feature carries a short neutral evidence string written by us (never competitor copy).
 */
import type { PageSignals } from './page-signals.js';

export const FEATURES = {
  atc_above_fold_mobile: 'Add-to-cart visible on the first mobile screen',
  sticky_atc_mobile: 'Sticky add-to-cart bar on mobile after scrolling',
  repeated_atc: 'Add-to-cart repeated further down the page',
  rating_near_price: 'Rating/reviews shown right next to the price',
  reviews_section: 'Dedicated reviews section',
  compare_at_shown: 'Original price struck through next to the sale price',
  discount_badge: 'Percentage-off or savings badge',
  emi_shown: 'EMI / pay-later option near the price',
  faq_section: 'FAQ section',
  comparison_table: 'Comparison table (vs alternatives)',
  specs_table: 'Specifications table',
  benefit_icon_grid: 'Benefit grid with icons',
  video: 'Product video',
  ugc: 'Customer photos / UGC',
  urgency: 'Urgency messaging (low stock, timers)',
  bundle_offer: 'Bundles / combos / frequently bought together',
  cod_mentioned: 'Cash on delivery mentioned',
  delivery_estimate: 'Delivery estimate or pincode check',
  returns_mentioned: 'Returns / exchange policy mentioned',
  trust_near_atc: 'Trust points (secure, returns, warranty…) next to add-to-cart',
  size_guide: 'Size guide',
  story_section: 'Brand / product story section',
} as const;
export type FeatureKey = keyof typeof FEATURES;

export interface CompetitorFeatures {
  features: Record<FeatureKey, { value: boolean; evidence: string }>;
  sectionOrder: string[];
  atcPlacement: 'first-screen' | 'below-fold' | 'none';
  headlineStyle: 'product-name' | 'benefit-led' | 'question' | 'numeric' | 'none';
  imageCount: number;
}

export function deriveFeatures(s: PageSignals, stickyAtc: boolean): CompetitorFeatures {
  const fold = s.viewport.h;
  const kinds = s.sections.map((x) => x.kind);
  const order: string[] = [];
  for (const k of kinds) if (k !== 'content' && order[order.length - 1] !== k) order.push(k);
  const has = (k: string) => kinds.includes(k);
  const f = (value: boolean, evidence: string) => ({ value, evidence });
  const atcTop = s.atc.firstTop;
  const features: CompetitorFeatures['features'] = {
    atc_above_fold_mobile: f(s.atc.aboveFold, atcTop == null ? 'no add-to-cart found' : `first add-to-cart at ${Math.round(atcTop)}px (screen ${fold}px)`),
    sticky_atc_mobile: f(stickyAtc, stickyAtc ? 'fixed bar with add-to-cart appeared after scrolling' : 'no fixed add-to-cart after scrolling'),
    repeated_atc: f(s.atc.count >= 2, `${s.atc.count} add-to-cart button(s) on the page`),
    rating_near_price: f(s.rating.nearPrice, s.rating.present ? (s.rating.nearPrice ? 'rating within ~250px of the price' : 'rating shown away from the price') : 'no rating shown'),
    reviews_section: f(has('reviews'), has('reviews') ? `reviews section at position ${kinds.indexOf('reviews') + 1}` : 'no reviews section detected'),
    compare_at_shown: f(s.price.hasCompare, s.price.hasCompare ? 'struck-through original price present' : 'no strike-through price'),
    discount_badge: f(s.price.discountBadge, s.price.discountBadge ? '% off / save badge near price' : 'no discount badge'),
    emi_shown: f(s.price.emi, s.price.emi ? 'EMI / pay-later text near price' : 'no EMI text'),
    faq_section: f(s.faq.present, s.faq.present ? `FAQ with ~${s.faq.questions} questions` : 'no FAQ'),
    comparison_table: f(s.comparisonTable, s.comparisonTable ? 'comparison table/section present' : 'no comparison'),
    specs_table: f(s.specsTable || has('specs'), s.specsTable ? 'spec table present' : has('specs') ? 'specs section present' : 'no spec table'),
    benefit_icon_grid: f(s.iconGrid, s.iconGrid ? 'icon + heading benefit grid' : 'no icon grid'),
    video: f(s.video, s.video ? 'video element present' : 'no video'),
    ugc: f(s.ugc || has('ugc'), s.ugc ? 'customer photo / social section' : 'no UGC'),
    urgency: f(s.urgency, s.urgency ? 'low-stock / timer style messaging' : 'no urgency messaging'),
    bundle_offer: f(s.bundle, s.bundle ? 'bundle / combo / bought-together module' : 'no bundles'),
    cod_mentioned: f(s.cod, s.cod ? 'COD mentioned on page' : 'COD not mentioned'),
    delivery_estimate: f(s.delivery, s.delivery ? 'delivery estimate / pincode check' : 'no delivery estimate'),
    returns_mentioned: f(s.returns, s.returns ? 'returns/exchange window mentioned' : 'no returns info'),
    trust_near_atc: f(s.trustNearAtc >= 2, `${s.trustNearAtc} trust point(s) in the purchase area`),
    size_guide: f(s.sizeGuide, s.sizeGuide ? 'size guide link' : 'no size guide'),
    story_section: f(has('story'), has('story') ? 'brand/product story block' : 'no story block'),
  };
  const h = s.h1;
  const headlineStyle: CompetitorFeatures['headlineStyle'] = !h ? 'none' : h.isQuestion ? 'question' : h.matchesTitle ? 'product-name' : h.hasNumber ? 'numeric' : 'benefit-led';
  return {
    features,
    sectionOrder: order.slice(0, 14),
    atcPlacement: atcTop == null ? 'none' : s.atc.aboveFold ? 'first-screen' : 'below-fold',
    headlineStyle,
    imageCount: s.imageCount,
  };
}
