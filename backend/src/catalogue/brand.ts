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
