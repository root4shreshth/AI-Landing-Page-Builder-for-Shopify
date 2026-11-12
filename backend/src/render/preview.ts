/**
 * Local preview renderer: renders the SAME built Liquid section files (shopify/dist/theme) with LiquidJS
 * and a small Shopify shim, so dashboard previews never drift from what Shopify renders.
 * Limitations (labelled in the UI as "local render"): no Dawn header/footer, fonts loaded from Google Fonts,
 * cart requests are simulated. Real checks run against the Shopify preview URL.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Liquid, Tag, type Emitter, type TagToken, type TopLevelToken, type Context } from 'liquidjs';
import { parseFontHandle, type ResolvedFont } from '../catalogue/fonts.js';
import type { ProductSnapshot } from '../catalogue/product.js';
import type { ShopifyTemplate } from './template.js';
import { hexToRgb } from './color.js';
import { DEFAULT_THEME_DIR, loadSectionSchemas, type SectionSchema } from './theme-schema.js';

export interface PreviewOptions {
  themeDir?: string;
  /** URL prefix where lp.css / lp-cart.js are served */
  assetBase?: string;
  /** simulate /cart/add.js responses inside the preview */
  simulateCart?: boolean;
  title?: string;
}

// ---------------- Shopify-like objects ----------------
interface MediaObj { media_type: 'image'; src: string; alt: string; width: number; height: number; preview_image: MediaObj | null; toString(): string }

function mediaFor(img: ProductSnapshot['images'][number]): MediaObj {
  const m: MediaObj = {
    media_type: 'image',
    src: img.src,
    alt: img.alt ?? '',
    width: img.width ?? 1200,
    height: img.height ?? 1200,
    preview_image: null,
    toString: () => img.src,
  };
  m.preview_image = m;
  return m;
}

export function shopifyProduct(p: ProductSnapshot, selectedVariantId?: string | number) {
  const media = p.images.map(mediaFor);
  const variants = p.variants.map((v) => ({
    id: v.id,
    title: v.title,
    options: v.options,
    price: v.price,
    compare_at_price: v.compareAtPrice ?? null,
    available: v.available,
    sku: v.sku ?? '',
    barcode: v.barcode ?? '',
  }));
  const selected = variants.find((v) => String(v.id) === String(selectedVariantId)) ?? variants.find((v) => v.available) ?? variants[0];
  const hasOnlyDefault = p.variants.length === 1 && (p.options.length === 0 || p.variants[0].title === 'Default Title');
  const options_with_values = p.options.map((name, i) => {
    const values = [...new Set(p.variants.map((v) => v.options[i]))];
    return {
      name,
      position: i + 1,
      selected_value: selected.options[i],
      values: values.map((val) => ({
        name: val,
        selected: selected.options[i] === val,
        available: p.variants.some((v) => v.options[i] === val && v.available),
        toString: () => val,
      })),
    };
  });
  return {
    id: 1,
    handle: p.handle,
    title: p.title,
    vendor: p.vendor ?? '',
    description: p.descriptionHtml,
    url: `/products/${p.handle}`,
    media,
    images: media,
    featured_media: media[0] ?? null,
    variants,
    selected_or_first_available_variant: selected,
    options_with_values,
    has_only_default_variant: hasOnlyDefault,
    collections: p.collection ? [{ ...p.collection, handle: p.collection.url.split('/').filter(Boolean).pop() ?? '' }] : [],
  };
}

// ---------------- filters ----------------
function formatMoney(cents: number, fmt: string): string {
  const n = Number(cents) || 0;
  const two = (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const zero = Math.round(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fmt
    .replace(/\{\{\s*amount_no_decimals\s*\}\}/, zero)
    .replace(/\{\{\s*amount\s*\}\}/, two)
    .replace(/\{\{\s*\w+\s*\}\}/, two);
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function withWidth(src: string, width?: number) {
  if (!width || src.startsWith('data:')) return src;
  try {
    const u = new URL(src, 'https://example.invalid');
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(src)) u.searchParams.set('width', String(width));
    return src.startsWith('http') ? u.toString() : src;
  } catch {
    return src;
  }
}

function placeholderSvg(cls?: string) {
  return `<svg class="${esc(cls ?? '')}" viewBox="0 0 525 525" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="525" height="525"/></svg>`;
}

function buildEngine(themeDir: string, assetBase: string, moneyFormat: string) {
  const engine = new Liquid({
    root: [path.join(themeDir, 'sections'), path.join(themeDir, 'snippets')],
    partials: [path.join(themeDir, 'snippets')],
    extname: '.liquid',
    cache: true,
    strictFilters: true,
    ownPropertyOnly: true,
  });

  // {% schema %} ... {% endschema %} renders nothing
  engine.registerTag(
    'schema',
    class extends Tag {
      constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
        super(token, remain, liquid);
        while (remain.length) {
          const t = remain.shift()!;
          if ((t as TagToken).name === 'endschema') return;
        }
        throw new Error('tag {% schema %} not closed');
      }
      render(_ctx: Context, _emitter: Emitter) {}
    },
  );

  engine.registerFilter('asset_url', (name: string) => `${assetBase}/${name}`);
  engine.registerFilter('stylesheet_tag', (url: string) => `<link rel="stylesheet" href="${esc(url)}" media="all">`);
  engine.registerFilter('money', (cents: number) => formatMoney(cents, moneyFormat));
  engine.registerFilter('money_without_currency', (cents: number) => formatMoney(cents, '{{amount}}'));
  engine.registerFilter('image_url', (img: MediaObj | string | null, opts?: unknown) => {
    if (!img) return '';
    const src = typeof img === 'string' ? img : img.src;
    // liquidjs passes keyword args as [key, value] arrays
    const width = Array.isArray(opts) && opts[0] === 'width' ? Number(opts[1]) : undefined;
    return withWidth(src, width);
  });
  engine.registerFilter('image_tag', function (url: string, ...args: unknown[]) {
    const kw: Record<string, string> = {};
    for (const a of args) if (Array.isArray(a)) kw[String(a[0])] = String(a[1]);
    const attrs: string[] = [`src="${esc(url)}"`];
    if (kw.widths) {
      const srcset = kw.widths.split(',').map((w) => `${esc(withWidth(url, Number(w.trim())))} ${w.trim()}w`).join(', ');
      attrs.push(`srcset="${srcset}"`);
    }
    if (kw.sizes) attrs.push(`sizes="${esc(kw.sizes)}"`);
    attrs.push(`alt="${esc(kw.alt ?? '')}"`);
    attrs.push(`width="${esc(kw.width ?? 1200)}"`, `height="${esc(kw.height ?? 1200)}"`);
    if (kw.loading) attrs.push(`loading="${esc(kw.loading)}"`);
    if (kw.fetchpriority && kw.fetchpriority !== 'auto') attrs.push(`fetchpriority="${esc(kw.fetchpriority)}"`);
    if (kw.class) attrs.push(`class="${esc(kw.class)}"`);
    return `<img ${attrs.join(' ')}>`;
  });
  engine.registerFilter('placeholder_svg_tag', (_name: string, cls?: string) => placeholderSvg(cls));
  engine.registerFilter('font_face', () => ''); // preview loads Google Fonts in <head> instead
  engine.registerFilter('font_modify', (f: ResolvedFont, prop: string, val: string) => (f && prop === 'weight' && val === 'bold' ? { ...f, weight: 700 } : f));
  // Shopify's color_brightness: perceived brightness 0-255 ((r*299 + g*587 + b*114) / 1000)
  engine.registerFilter('color_brightness', (hex: string) => {
    if (typeof hex !== 'string' || !hex.startsWith('#')) return 0;
    const [r, g, b] = hexToRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000;
  });
  engine.registerFilter('color_modify', (hex: string, prop: string, val: number) => {
    if (prop !== 'alpha' || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${val})`;
  });
  return engine;
}

// ---------------- page ----------------
export async function renderPreview(
  template: ShopifyTemplate,
  product: ProductSnapshot,
  opts: PreviewOptions = {},
): Promise<string> {
  const themeDir = opts.themeDir ?? DEFAULT_THEME_DIR;
  const assetBase = opts.assetBase ?? '/preview-assets';
  const engine = buildEngine(themeDir, assetBase, product.moneyFormat);
  const schemas = await loadSectionSchemas(themeDir);
  const prod = shopifyProduct(product);
  const fonts = new Map<string, ResolvedFont>();

  const globals = {
    product: prod,
    shop: { name: product.vendor ?? 'Store', money_format: product.moneyFormat },
    routes: { cart_add_url: '/cart/add', cart_url: '/cart', root_url: '/' },
    request: { origin: 'https://preview.local', design_mode: false, page_type: 'product' },
    cart: { currency: { iso_code: product.currency } },
  };

  let body = '';
  for (const id of template.order) {
    const sec = template.sections[id];
    const schema: SectionSchema | undefined = schemas.get(sec.type);
    const src = await readFile(path.join(themeDir, 'sections', `${sec.type}.liquid`), 'utf8');
    const settings = withDefaults(schema?.settings ?? [], sec.settings, fonts);
    const blocks = (sec.block_order ?? []).map((bid) => {
      const b = sec.blocks![bid];
      const bdef = schema?.blocks.find((d) => d.type === b.type);
      return { id: bid, type: b.type, settings: withDefaults(bdef?.settings ?? [], b.settings, fonts), shopify_attributes: '' };
    });
    // Shopify objects are true globals (visible inside {% render %} snippets), so pass them as LiquidJS globals.
    const html = await engine.parseAndRender(src, { section: { id, settings, blocks } }, { globals });
    body += `<div id="shopify-section-${id}" class="shopify-section">${html}</div>\n`;
  }

  const families = [...new Set([...fonts.values()].map((f) => f.family))];
  const weights = [...new Set([...fonts.values()].map((f) => f.weight)).add(400).add(700)].sort();
  const gf = families.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${weights.join(';')}`).join('&')}&display=swap">`
    : '';

  const cartShim = opts.simulateCart === false ? '' : `<script>
  // Preview only: simulate Shopify's Ajax Cart API so add-to-cart can be exercised locally.
  window.__lpCartCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (String(url).includes('cart/add.js')) {
      const body = JSON.parse(init.body);
      window.__lpCartCalls.push(body);
      await new Promise(r => setTimeout(r, 150));
      return new Response(JSON.stringify({ id: body.id, quantity: body.quantity, key: body.id + ':preview' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title ?? product.title)} — local preview</title>
<meta name="description" content="Local preview of a generated landing page">
<link rel="icon" href="data:,">
${gf}
<style>
  html { font-size: 62.5%; -webkit-text-size-adjust: 100%; }
  body { margin: 0; font-size: 1.6rem; overflow-x: hidden; }
  .lp-preview-banner { font: 12px/1.4 system-ui, sans-serif; background: #111; color: #fff; padding: 6px 12px; text-align: center; }
</style>
${cartShim}
</head>
<body>
<div class="lp-preview-banner" role="note">Local preview · cart simulated · theme header on Shopify</div>
<main id="MainContent">
${body}
</main>
</body>
</html>`;
}

/** Merge template settings over schema defaults; resolve font handles to font objects. */
function withDefaults(defs: SectionSchema['settings'], values: Record<string, unknown>, fonts: Map<string, ResolvedFont>) {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    if (!d.id) continue;
    const raw = d.id in values ? values[d.id] : (d as { default?: unknown }).default;
    if (d.type === 'font_picker' && typeof raw === 'string') {
      const f = parseFontHandle(raw);
      fonts.set(raw, f);
      out[d.id] = f;
    } else if (d.type === 'image_picker') {
      out[d.id] = null; // generated templates never set custom images; sections fall back to product media
    } else {
      out[d.id] = raw ?? null;
    }
  }
  return out;
}
