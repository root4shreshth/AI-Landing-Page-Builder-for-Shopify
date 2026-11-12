/**
 * Evidence-linked learnings computed in code (counts are never produced by an LLM).
 * Each learning = observation (fact: "6 of 8 pages …", with source pages), hypothesis (why it might help —
 * explicitly not proof) and recommendation (what our designs do with it, gated by our real data).
 */
import { FEATURES, type CompetitorFeatures, type FeatureKey } from './features.js';

export interface LearningSource { competitorId: string; url: string; domain: string }
export interface Learning {
  key: FeatureKey | `section_${string}`;
  kind: 'common' | 'differentiator' | 'rare';
  observation: string;
  hypothesis: string;
  recommendation: string;
  supportCount: number;
  sampleSize: number;
  share: number;
  sources: LearningSource[];
}

const HYP: Partial<Record<FeatureKey, [string, string]>> = {
  atc_above_fold_mobile: ['Shoppers on mobile can act without scrolling, which may reduce drop-off.', 'Keep the primary add-to-cart on the first mobile screen in every design.'],
  sticky_atc_mobile: ['A persistent buy button may help shoppers who scroll through details before deciding.', 'Include the sticky add-to-cart bar (mobile) in every design.'],
  repeated_atc: ['Repeating the CTA after persuasive sections may capture intent at the moment it forms.', 'Repeat a scroll-to-buy CTA after benefits or reviews.'],
  rating_near_price: ['Social proof at the decision point may increase confidence.', 'Show the real rating next to the price — only when the product has genuine reviews.'],
  reviews_section: ['Detailed reviews may answer fit/quality doubts.', 'Use a reviews section when real reviews exist; otherwise omit it (no invented reviews).'],
  compare_at_shown: ['A visible reference price frames the deal.', 'Show the struck-through compare-at price only when the store sets one.'],
  discount_badge: ['A % off badge makes savings scannable.', 'Show a savings badge computed from the real compare-at price.'],
  faq_section: ['Answering common questions inline may reduce hesitation and support queries.', 'Include an FAQ with short, factual answers (also helps AEO).'],
  comparison_table: ['Comparisons help shoppers justify the choice.', 'Use a comparison against a generic alternative (never named competitors) in the benefit-grid direction.'],
  specs_table: ['Scannable specs answer factual questions quickly and are quotable by AI search.', 'Include a specs table built from real product data.'],
  benefit_icon_grid: ['Icon grids make key benefits skimmable.', 'Use an icon benefit grid in at least one direction.'],
  video: ['Video can show the product in use.', 'Consider product video when the merchant has one (not generated).'],
  ugc: ['Customer photos act as authentic proof.', 'Use UGC only from real customer content the merchant owns.'],
  urgency: ['Urgency can push decisions but risks trust if not genuine.', 'Do not add fake timers or stock counts; only real offer end dates.'],
  bundle_offer: ['Bundles can raise order value.', 'Feature bundles only if the store sells them.'],
  cod_mentioned: ['COD availability matters to many Indian shoppers.', 'Show COD in trust points only when the store confirms it.'],
  delivery_estimate: ['Delivery timing reduces uncertainty.', 'Show delivery estimates only from confirmed store data.'],
  returns_mentioned: ['A clear return policy lowers perceived risk.', 'Show the returns window near the CTA when confirmed.'],
  trust_near_atc: ['Reassurance at the CTA may reduce last-second hesitation.', 'Place verified trust points directly under the add-to-cart.'],
  size_guide: ['Size guidance reduces fit anxiety for apparel/footwear.', 'Link a size guide when the store has one.'],
  story_section: ['A brand story can differentiate similar products.', 'Use a story section in the story-led direction.'],
  emi_shown: ['EMI lowers the perceived price of expensive items.', 'Mention EMI only if the store offers it at checkout.'],
};

export function computeLearnings(items: { id: string; url: string; domain: string; features: CompetitorFeatures }[]): Learning[] {
  const n = items.length;
  if (!n) return [];
  const out: Learning[] = [];
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const support = items.filter((i) => i.features.features[key].value);
    const share = support.length / n;
    const kind: Learning['kind'] = share >= 0.6 ? 'common' : share <= 0.25 ? 'rare' : 'differentiator';
    const [hyp, rec] = HYP[key] ?? ['', ''];
    const raw = FEATURES[key];
    const label = /^[A-Z]{2}/.test(raw) ? raw : raw.charAt(0).toLowerCase() + raw.slice(1); // keep acronyms (FAQ, EMI)
    out.push({
      key,
      kind,
      observation: `${support.length} of ${n} pages: ${label}`,
      hypothesis: hyp ? `Hypothesis (not proven): ${hyp}` : '',
      recommendation: rec,
      supportCount: support.length,
      sampleSize: n,
      share: Math.round(share * 100) / 100,
      sources: support.map((s) => ({ competitorId: s.id, url: s.url, domain: s.domain })),
    });
  }
  // section-position learnings, e.g. "reviews usually appear as the 2nd section"
  const positions = new Map<string, number[]>();
  for (const i of items) {
    // first occurrence per page only, so counts are "pages with X", not occurrences
    i.features.sectionOrder.forEach((k, idx) => {
      if (i.features.sectionOrder.indexOf(k) !== idx) return;
      if (!positions.has(k)) positions.set(k, []);
      positions.get(k)!.push(idx + 1);
    });
  }
  for (const [k, pos] of positions) {
    if (pos.length < Math.max(2, Math.ceil(n / 2)) || ['content', 'hero', 'purchase', 'recommendations'].includes(k)) continue;
    const sorted = [...pos].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    out.push({
      key: `section_${k}`,
      kind: 'common',
      observation: `${pos.length} of ${n} pages have a ${k} section, typically at position ${median}`,
      hypothesis: '',
      recommendation: `Consider ${k} around position ${median}, but vary placement across directions to stay distinct.`,
      supportCount: pos.length,
      sampleSize: n,
      share: Math.round((pos.length / n) * 100) / 100,
      sources: items.filter((i) => i.features.sectionOrder.includes(k)).map((s) => ({ competitorId: s.id, url: s.url, domain: s.domain })),
    });
  }
  return out.sort((a, b) => b.share - a.share);
}
