import { z } from 'zod';
import { ICONS } from './icons.js';

/**
 * The AI output contract: an allowlisted section catalogue with bounded, known settings.
 * The LLM never writes Liquid. Style/colour/font settings are NOT part of this contract —
 * the renderer derives them from the (user-correctable) brand profile + the design's visual strategy.
 * Factual content (specs, reviews, ratings, trust claims, offers) is referenced, not written.
 */

export const DIRECTIONS = ['story-led', 'benefit-grid', 'social-proof', 'offer-led'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const txt = (max: number) => z.string().trim().max(max);
const rich = (max: number) => z.string().trim().max(max); // sanitized + length-checked again after sanitizing
const icon = z.enum(ICONS);
const align = z.enum(['left', 'center']);

const block = <T extends string, S extends z.ZodRawShape>(type: T, settings: S) =>
  z.object({ type: z.literal(type), settings: z.object(settings).strict() }).strict();

const highlight = block('highlight', { icon, text: txt(80).min(1) });

export const HeroSection = z
  .object({
    type: z.literal('hero'),
    settings: z
      .object({
        layout: z.enum(['split', 'overlay', 'stacked', 'collage']),
        media_position: z.enum(['right', 'left']).default('right'),
        image_ratio: z.enum(['square', 'portrait', 'landscape', 'natural']).default('portrait'),
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        subheading: rich(320).optional(),
        show_buy_form: z.boolean().default(true),
        show_options: z.boolean().default(true),
        show_qty: z.boolean().default(true),
        button_label: txt(30).default('Add to cart'),
        scrim: z.number().int().min(0).max(80).default(40),
        show_rating: z.boolean().default(false),
      })
      .strict(),
    blocks: z.array(highlight).max(6).default([]),
  })
  .strict();

export const PurchaseSection = z
  .object({
    type: z.literal('purchase'),
    settings: z
      .object({
        media_position: z.enum(['left', 'right']).default('left'),
        gallery_style: z.enum(['grid', 'stack', 'strip']).default('grid'),
        image_ratio: z.enum(['square', 'portrait', 'natural']).default('square'),
        show_breadcrumb: z.boolean().default(true),
        show_vendor: z.boolean().default(true),
        title: txt(90).optional(),
        description_source: z.enum(['product', 'custom', 'none']).default('custom'),
        description: rich(1200).optional(),
        show_options: z.boolean().default(true),
        show_qty: z.boolean().default(true),
        button_label: txt(30).default('Add to cart'),
        show_rating: z.boolean().default(false),
      })
      .strict(),
    /** ids from ProductFacts.claims — unknown ids are dropped */
    claimIds: z.array(z.string()).max(4).default([]),
    blocks: z.array(highlight).max(6).default([]),
  })
  .strict();

export const BenefitsSection = z
  .object({
    type: z.literal('benefits'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(400).optional(),
        layout: z.enum(['grid', 'list']).default('grid'),
        columns: z.enum(['2', '3', '4']).default('3'),
        card_style: z.enum(['filled', 'outline', 'plain']).default('filled'),
        align: align.default('left'),
        cta_label: txt(30).optional(),
      })
      .strict(),
    blocks: z.array(block('benefit', { icon, title: txt(60).min(1), text: rich(320).optional() })).min(2).max(8),
  })
  .strict();

export const SpecsSection = z
  .object({
    type: z.literal('specs'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(400).optional(),
        layout: z.enum(['split', 'stacked']).default('split'),
      })
      .strict(),
    /** Spec rows are filled from ProductFacts.specs by the renderer. */
    maxRows: z.number().int().min(1).max(30).default(12),
    /** Short factual notes, e.g. "Who it's for", "What's in the box" — must be supported by facts. */
    blocks: z.array(block('note', { title: txt(40).min(1), text: rich(400).min(1) })).max(3).default([]),
  })
  .strict();

export const FaqSection = z
  .object({
    type: z.literal('faq'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(300).optional(),
        style: z.enum(['lines', 'cards', 'split']).default('lines'),
        align: align.default('left'),
        open_first: z.boolean().default(false),
      })
      .strict(),
    blocks: z.array(block('qa', { question: txt(120).min(5), answer: rich(700).min(5) })).min(3).max(10),
  })
  .strict();

export const GallerySection = z
  .object({
    type: z.literal('gallery'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).optional(),
        intro: rich(300).optional(),
        align: align.default('left'),
        limit: z.number().int().min(2).max(12).default(6),
        layout: z.enum(['grid', 'mosaic', 'strip']).default('grid'),
        columns: z.enum(['3', '4']).default('3'),
        image_ratio: z.enum(['square', 'portrait', 'landscape']).default('square'),
      })
      .strict(),
  })
  .strict();

export const ComparisonSection = z
  .object({
    type: z.literal('comparison'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(300).optional(),
        align: align.default('left'),
        other_label: txt(40).default('Typical alternative'),
      })
      .strict(),
    blocks: z.array(block('row', { feature: txt(50).min(1), ours: txt(40).min(1), other: txt(40).min(1) })).min(3).max(8),
  })
  .strict();

export const ReviewsSection = z
  .object({
    type: z.literal('reviews'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(300).optional(),
        align: align.default('left'),
        layout: z.enum(['grid', 'wall']).default('grid'),
        card_style: z.enum(['filled', 'outline', 'plain']).default('filled'),
      })
      .strict(),
    /** Reviews are filled from ProductFacts.reviews by the renderer. */
    maxReviews: z.number().int().min(1).max(12).default(6),
  })
  .strict();

export const TrustSection = z
  .object({
    type: z.literal('trust'),
    settings: z.object({ heading: txt(60).optional(), density: z.enum(['compact', 'roomy']).default('compact') }).strict(),
    claimIds: z.array(z.string()).min(1).max(6),
  })
  .strict();

export const OfferSection = z
  .object({
    type: z.literal('offer'),
    settings: z
      .object({
        style: z.enum(['card', 'bar']).default('card'),
        show_savings: z.boolean().default(true),
        button_label: txt(30).optional(),
      })
      .strict(),
  })
  .strict();

export const StorySection = z
  .object({
    type: z.literal('story'),
    settings: z
      .object({
        eyebrow: txt(40).optional(),
        heading: txt(90).min(1),
        intro: rich(400).optional(),
        align: align.default('left'),
        layout: z.enum(['alternate', 'centered']).default('alternate'),
        image_ratio: z.enum(['square', 'portrait', 'landscape']).default('landscape'),
      })
      .strict(),
    blocks: z
      .array(block('chapter', { eyebrow: txt(40).optional(), heading: txt(80).min(1), text: rich(700).min(1), use_product_image: z.boolean().default(true) }))
      .min(1)
      .max(4),
  })
  .strict();

export const SectionConfig = z.discriminatedUnion('type', [
  HeroSection, PurchaseSection, BenefitsSection, SpecsSection, FaqSection, GallerySection,
  ComparisonSection, ReviewsSection, TrustSection, OfferSection, StorySection,
]);
export type SectionConfig = z.infer<typeof SectionConfig>;
export type SectionType = SectionConfig['type'];

export const VisualStrategy = z
  .object({
    /** light: brand background throughout; banded: alternating tinted bands; contrast: dark/primary hero + bold bands; warm: soft secondary-tinted surfaces */
    colorStrategy: z.enum(['light', 'banded', 'contrast', 'warm']),
    radius: z.enum(['brand', 'sharp', 'soft', 'round']).default('brand'),
    density: z.enum(['airy', 'balanced', 'compact']).default('balanced'),
    /** Accent usage: which brand colour drives accents/buttons */
    accent: z.enum(['primary', 'secondary']).default('primary'),
  })
  .strict();
export type VisualStrategy = z.infer<typeof VisualStrategy>;

export const PageConfigSchema = z
  .object({
    designName: txt(60).min(1),
    direction: z.enum(DIRECTIONS),
    rationale: txt(600).optional(),
    visual: VisualStrategy,
    sections: z.array(SectionConfig).min(3).max(12),
  })
  .strict();
export type PageConfig = z.infer<typeof PageConfigSchema>;
export type PageConfigInput = z.input<typeof PageConfigSchema>;
