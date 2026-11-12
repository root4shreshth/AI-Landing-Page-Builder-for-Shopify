/**
 * Content for data-only sections, derived from verified facts (never from the LLM):
 *  - fact strip: short spec values ("400 GSM" / "Fabric weight"), numbers preferred
 *  - brand band: verified store promises + short product facts
 */
import type { ProductFacts } from '../catalogue/facts.js';

const UNIT_LABELS: [RegExp, string][] = [
  [/gsm/i, 'Fabric weight'], [/\b(ml|l|litres?|liters?)\b/i, 'Capacity'], [/\b(kg|g|grams?)\b/i, 'Weight'],
  [/\b(mm|cm|inch(es)?|")\b/i, 'Size'], [/\bmah\b/i, 'Battery'], [/\bhrs?|hours?\b/i, 'Playtime'],
];

/** Measured values stated in the product title itself, e.g. "Oversized Hoodie 400 GSM" -> 400 GSM. */
export function titleFacts(title: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const m of title.matchAll(/\b(\d+(?:\.\d+)?)\s?(gsm|ml|l|kg|g|mm|cm|mah|hrs?|hours?)\b/gi)) {
    const label = UNIT_LABELS.find(([re]) => re.test(m[2]))?.[1];
    if (label) out.push({ value: `${m[1]} ${m[2].toUpperCase() === 'GSM' || m[2].toUpperCase() === 'MAH' ? m[2].toUpperCase() : m[2].toLowerCase()}`, label });
  }
  return out;
}

export function factItems(facts: ProductFacts, max = 4): { value: string; label: string }[] {
  const fromTitle = titleFacts(facts.title).map((f) => ({ ...f, source: 'dom' as const }));
  const short = [...facts.specs, ...fromTitle].filter((s) => s.value.length <= 16 && s.label.length <= 28 && !/^(yes|no|n\/a|-)$/i.test(s.value.trim()));
  const ranked = [...short].sort((a, b) => Number(/\d/.test(b.value)) - Number(/\d/.test(a.value)));
  const out: { value: string; label: string }[] = [];
  for (const s of ranked) {
    if (out.some((o) => o.label.toLowerCase() === s.label.toLowerCase())) continue;
    out.push({ value: s.value.trim(), label: s.label.trim() });
    if (out.length >= max) break;
  }
  return out;
}

export function marqueeItems(facts: ProductFacts, max = 8): string[] {
  const items = [
    ...facts.claims.map((c) => c.title),
    ...titleFacts(facts.title).map((f) => f.value),
    ...facts.specs.filter((s) => s.value.length <= 22 && /\d|cotton|leather|steel|organic|handmade|made in/i.test(s.value)).map((s) => s.value),
    ...facts.highlights.filter((h) => h.length <= 28),
  ].map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true))).slice(0, max);
}

export const hasFactStrip = (f: ProductFacts) => factItems(f).length >= 2;
export const hasMarquee = (f: ProductFacts) => marqueeItems(f).length >= 3;
