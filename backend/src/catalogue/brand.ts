import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');
/** Shopify font library handle, e.g. "playfair_display_n7", "assistant_n4". */
export const fontHandle = z.string().regex(/^[a-z0-9_]+_[nio][1-9]$/, 'expected Shopify font handle like assistant_n4');

/** The (user-correctable) brand profile values the renderer consumes. */
export const BrandTokensSchema = z.object({
  colors: z.object({
    primary: hex,
    secondary: hex,
    background: hex,
    text: hex,
    button: hex,
    buttonText: hex,
  }),
  fonts: z.object({ heading: fontHandle, body: fontHandle }),
  radiusPx: z.number().int().min(0).max(32),
  tone: z.array(z.string()).default([]),
});
export type BrandTokens = z.infer<typeof BrandTokensSchema>;

export const TONES = ['premium', 'minimal', 'playful', 'bold', 'warm', 'technical', 'eco-conscious', 'youthful', 'luxury', 'friendly', 'clinical', 'rugged', 'traditional', 'edgy'] as const;
export const IMAGE_STYLES = ['studio-white', 'lifestyle', 'flat-lay', 'editorial', 'model-on-figure', 'product-closeups', 'illustrative', 'mixed', 'unknown'] as const;

const fontRef = z.object({
  /** Shopify font library handle used in templates */
  handle: fontHandle,
  /** family detected on the source site (may not exist in Shopify's library) */
  detectedFamily: z.string().max(80),
  matched: z.enum(['exact', 'closest', 'default']),
});

/** Full editable brand profile (what the dashboard shows and the user corrects). */
export const BrandProfileSchema = z.object({
  colors: BrandTokensSchema.shape.colors,
  fonts: z.object({ heading: fontRef, body: fontRef, headingSizePx: z.number().min(10).max(120).optional(), bodySizePx: z.number().min(10).max(30).optional() }),
  button: z.object({ radiusPx: z.number().int().min(0).max(32), style: z.enum(['solid', 'outline', 'pill']), textTransform: z.enum(['none', 'uppercase', 'capitalize']).default('none') }),
  spacing: z.enum(['compact', 'balanced', 'airy']),
  tone: z.array(z.enum(TONES)).max(4).default([]),
  toneSummary: z.string().max(300).default(''),
  imageStyle: z.enum(IMAGE_STYLES).default('unknown'),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export interface FieldConfidence { value: number; source: 'css' | 'screenshot' | 'css+screenshot' | 'llm' | 'heuristic' | 'default' | 'user'; note?: string }
export type BrandConfidence = Record<string, FieldConfidence>;

export function tokensFromProfile(p: BrandProfile): BrandTokens {
  return BrandTokensSchema.parse({
    colors: p.colors,
    fonts: { heading: p.fonts.heading.handle, body: p.fonts.body.handle },
    radiusPx: p.button.style === 'pill' ? 32 : p.button.radiusPx,
    tone: p.tone,
  });
}
