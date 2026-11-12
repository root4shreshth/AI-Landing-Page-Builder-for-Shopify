import { z } from 'zod';
import { ICONS } from './icons.js';

/**
 * Verified product facts. Everything here was extracted from the source page (or entered by the user).
 * The renderer fills factual sections (specs, reviews, trust, offer, ratings) ONLY from this object,
 * never from LLM output.
 */
export const factSource = z.enum(['shopify_json', 'json_ld', 'dom', 'user', 'meta']);

export const ProductFactsSchema = z.object({
  title: z.string().min(1),
  vendor: z.string().optional(),
  brandName: z.string().min(1),
  category: z.string().optional(),
  descriptionText: z.string().default(''),
  hasCompareAt: z.boolean().default(false),
  rating: z
    .object({ value: z.number().min(0).max(5), count: z.number().int().min(1), source: z.string() })
    .optional(),
  reviews: z
    .array(
      z.object({
        author: z.string().min(1).max(60),
        rating: z.number().int().min(0).max(5).optional(),
        title: z.string().max(120).optional(),
        body: z.string().min(1).max(1200),
        date: z.string().max(40).optional(),
        verified: z.boolean().optional(),
      }),
    )
    .default([]),
  specs: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(160), source: factSource })).default([]),
  /** Unlabelled bullet points from the product description (grounding for benefit copy). */
  highlights: z.array(z.string().min(1).max(160)).default([]),
  /** Verified store claims (delivery, COD, returns…). id is referenced by the AI config. */
  claims: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
        icon: z.enum(ICONS),
        title: z.string().min(1).max(40),
        text: z.string().max(80).optional(),
        source: z.string(),
        /** Exact text on the source page that supports the claim (shown to the user for confirmation). */
        evidence: z.string().max(200).optional(),
      }),
    )
    .default([]),
  offer: z.object({ text: z.string().min(1).max(80), subtext: z.string().max(300).optional(), code: z.string().max(30).optional(), source: z.string() }).optional(),
});
export type ProductFacts = z.infer<typeof ProductFactsSchema>;

/**
 * Store-policy questions (COD, returns, delivery) may only appear when the store confirms that promise.
 * Shared by the FAQ assembly (drops unbacked questions) and the AEO checklist (flags any that remain).
 */
const POLICY_TOPICS: [RegExp, string[]][] = [
  [/\b(cod|cash on delivery)\b/i, ['cod']],
  [/\breturn|exchange|refund/i, ['returns']],
  [/\bdeliver|ship|dispatch/i, ['delivery_time', 'free_shipping']],
];
export function isUnbackedPolicyQuestion(question: string, claimIds: ReadonlySet<string>): boolean {
  return POLICY_TOPICS.some(([re, ids]) => re.test(question) && !ids.some((id) => claimIds.has(id)));
}
