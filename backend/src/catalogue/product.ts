import { z } from 'zod';

/** Normalised product snapshot (from a public Shopify product page or the dev store). Prices in minor units. */
export const ProductSnapshotSchema = z.object({
  handle: z.string(),
  title: z.string(),
  vendor: z.string().optional(),
  descriptionHtml: z.string().default(''),
  url: z.string(),
  currency: z.string().default('INR'),
  moneyFormat: z.string().default('Rs. {{amount}}'),
  images: z.array(z.object({ src: z.string(), alt: z.string().optional(), width: z.number().optional(), height: z.number().optional() })).default([]),
  options: z.array(z.string()).default([]),
  variants: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        title: z.string(),
        options: z.array(z.string()),
        price: z.number().int(),
        compareAtPrice: z.number().int().nullable().optional(),
        available: z.boolean(),
        sku: z.string().optional(),
        barcode: z.string().optional(),
      }),
    )
    .min(1),
  collection: z.object({ title: z.string(), url: z.string() }).optional(),
});
export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>;
