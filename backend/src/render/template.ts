import { BrandTokensSchema, type BrandTokens } from '../catalogue/brand.js';
import { ProductFactsSchema, type ProductFacts } from '../catalogue/facts.js';
import { PageConfigSchema, type PageConfig, type PageConfigInput, type SectionConfig } from '../catalogue/page-config.js';
import { cleanRichtext, cleanText } from './sanitize.js';
import { styleFor, type RenderedType } from './style.js';

/** Catalogue type -> Liquid section file (sections/<name>.liquid) */
export const LIQUID_TYPE: Record<RenderedType, string> = {
  hero: 'lp-hero',
  purchase: 'lp-purchase',
  benefits: 'lp-benefits',
  specs: 'lp-specs',
  faq: 'lp-faq',
  gallery: 'lp-gallery',
  comparison: 'lp-comparison',
  reviews: 'lp-reviews',
  trust: 'lp-trust',
  offer: 'lp-offer',
  story: 'lp-story',
  seo: 'lp-seo',
  sticky: 'lp-sticky-atc',
};

type Settings = Record<string, string | number | boolean>;
interface TemplateBlock { type: string; settings: Settings }
interface TemplateSection { type: string; settings: Settings; blocks?: Record<string, TemplateBlock>; block_order?: string[] }
export interface ShopifyTemplate { sections: Record<string, TemplateSection>; order: string[] }

export interface RenderNote { level: 'info' | 'warning'; section?: string; message: string }
export interface RenderResult {
  template: ShopifyTemplate;
  /** e.g. "lp-abc123-story" -> templates/product.lp-abc123-story.json, preview with ?view=lp-abc123-story */
  templateSuffix: string;
  fileName: string;
  /** final rendered section order (catalogue types, incl. seo/sticky) */
  renderedOrder: RenderedType[];
  notes: RenderNote[];
  config: PageConfig;
}

export function templateSuffixFor(slug: string, direction: string, version = 1): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dir = { 'story-led': 'story', 'benefit-grid': 'grid', 'social-proof': 'proof', 'offer-led': 'offer' }[direction] ?? clean(direction);
  return `lp-${clean(slug).slice(0, 40)}-${dir}${version > 1 ? `-v${version}` : ''}`;
}

const t = cleanText;
const rt = cleanRichtext;
const put = (o: Settings, k: string, v: string | number | boolean | undefined) => {
  if (v === undefined) return;
  if (typeof v === 'string' && v === '') return;
  o[k] = v;
};

export function renderTemplate(
  configInput: PageConfigInput,
  factsInput: ProductFacts,
  brandInput: BrandTokens,
  opts: { slug: string; version?: number },
): RenderResult {
  const config = PageConfigSchema.parse(configInput);
  const facts = ProductFactsSchema.parse(factsInput);
  const brand = BrandTokensSchema.parse(brandInput);
  const notes: RenderNote[] = [];

  // ---------- 1. structural rules ----------
  let sections: SectionConfig[] = [...config.sections];

  // One FAQ (one FAQPage), one hero, one purchase, one sticky.
  const seen = new Set<string>();
  sections = sections.filter((s) => {
    if (['faq', 'hero', 'purchase', 'offer', 'reviews'].includes(s.type)) {
      if (seen.has(s.type)) {
        notes.push({ level: 'warning', section: s.type, message: `Duplicate ${s.type} section removed.` });
        return false;
      }
      seen.add(s.type);
    }
    return true;
  });

  // ---------- 2. factual gating ----------
  const claimById = new Map(facts.claims.map((c) => [c.id, c]));
  sections = sections.filter((s) => {
    switch (s.type) {
      case 'reviews':
        if (facts.reviews.length === 0 && !facts.rating) {
          notes.push({ level: 'info', section: 'reviews', message: 'Reviews section omitted: no real reviews or rating were found on the source page.' });
          return false;
        }
        return true;
      case 'trust': {
        const valid = s.claimIds.filter((id) => claimById.has(id));
        if (valid.length !== s.claimIds.length)
          notes.push({ level: 'warning', section: 'trust', message: `Dropped unverified trust claims: ${s.claimIds.filter((id) => !claimById.has(id)).join(', ')}` });
        if (valid.length === 0) {
          notes.push({ level: 'info', section: 'trust', message: 'Trust section omitted: no verified store claims (delivery/COD/returns) available.' });
          return false;
        }
        s.claimIds = valid;
        return true;
      }
      case 'purchase': {
        const dropped = s.claimIds.filter((id) => !claimById.has(id));
        if (dropped.length) notes.push({ level: 'warning', section: 'purchase', message: `Dropped unverified trust claims: ${dropped.join(', ')}` });
        s.claimIds = s.claimIds.filter((id) => claimById.has(id));
        return true;
      }
      case 'offer':
        if (!facts.offer && !facts.hasCompareAt) {
          notes.push({ level: 'info', section: 'offer', message: 'Offer section omitted: no confirmed offer and no compare-at price.' });
          return false;
        }
        return true;
      case 'specs':
        if (facts.specs.length === 0 && s.blocks.length === 0) {
          notes.push({ level: 'info', section: 'specs', message: 'Specs section omitted: no specifications were extracted.' });
          return false;
        }
        return true;
      default:
        return true;
    }
  });

  // Primary ATC must be on the first mobile screen: first section must be a hero with buy form, or purchase.
  const first = sections[0];
  if (!first || (first.type !== 'hero' && first.type !== 'purchase')) {
    const existing = sections.findIndex((s) => s.type === 'purchase' || s.type === 'hero');
    if (existing > 0) {
      const [moved] = sections.splice(existing, 1);
      sections.unshift(moved);
      notes.push({ level: 'warning', message: `Moved ${moved.type} to the top so add-to-cart is visible on the first mobile screen.` });
    } else {
      sections.unshift({ type: 'purchase', settings: { media_position: 'left', gallery_style: 'grid', image_ratio: 'square', show_breadcrumb: true, show_vendor: true, description_source: 'none', show_options: true, show_qty: true, button_label: 'Add to cart', show_rating: false }, claimIds: [], blocks: [] });
      notes.push({ level: 'warning', message: 'Added a purchase section at the top: the design had no primary add-to-cart.' });
    }
  }
  const top = sections[0];
  if (top.type === 'hero' && !top.settings.show_buy_form) {
    top.settings.show_buy_form = true;
    notes.push({ level: 'warning', section: 'hero', message: 'Enabled the hero add-to-cart so a purchase CTA is visible on the first mobile screen.' });
  }

  const pageShowsRating =
    !!facts.rating &&
    sections.some(
      (s) => s.type === 'reviews' || ((s.type === 'hero' || s.type === 'purchase') && s.settings.show_rating),
    );

  // ---------- 3. build template ----------
  const out: ShopifyTemplate = { sections: {}, order: [] };
  const renderedOrder: RenderedType[] = [];
  const counters: Record<string, number> = {};
  let h1Used = false;
  let contentIndex = 0;

  const add = (type: RenderedType, settings: Settings, blocks?: TemplateBlock[]) => {
    counters[type] = (counters[type] ?? 0) + 1;
    const id = `${type}_${counters[type]}`;
    const style = styleFor(type, type === 'seo' || type === 'sticky' ? 0 : contentIndex, brand, config.visual);
    if (type !== 'seo' && type !== 'sticky') contentIndex++;
    const section: TemplateSection = { type: LIQUID_TYPE[type], settings: { ...settings, ...style } };
    if (blocks && blocks.length) {
      section.blocks = {};
      section.block_order = [];
      const bc: Record<string, number> = {};
      for (const b of blocks) {
        bc[b.type] = (bc[b.type] ?? 0) + 1;
        const bid = `${b.type}_${bc[b.type]}`;
        section.blocks[bid] = b;
        section.block_order.push(bid);
      }
    }
    out.sections[id] = section;
    out.order.push(id);
    renderedOrder.push(type);
  };

  // SEO / breadcrumb first (structured data + internal collection link)
  {
    const s: Settings = { show_breadcrumb: top.type !== 'purchase' };
    put(s, 'brand_name', t(facts.brandName, 60));
    if (pageShowsRating && facts.rating) {
      s.rating_value = String(facts.rating.value);
      s.rating_count = String(facts.rating.count);
    }
    add('seo', s);
  }

  for (const sec of sections) {
    const s: Settings = {};
    switch (sec.type) {
      case 'hero': {
        const st = sec.settings;
        Object.assign(s, { layout: st.layout, media_position: st.media_position, image_ratio: st.image_ratio, show_buy_form: st.show_buy_form, show_options: st.show_options, show_qty: st.show_qty, scrim: Math.round(st.scrim / 5) * 5 });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'subheading', rt(st.subheading, 400));
        put(s, 'button_label', t(st.button_label, 30) || 'Add to cart');
        s.heading_tag = h1Used ? 'h2' : 'h1';
        h1Used = true;
        if (st.show_rating && facts.rating) Object.assign(s, { show_rating: true, rating_value: String(facts.rating.value), rating_count: String(facts.rating.count) });
        add('hero', s, sec.blocks.map((b) => ({ type: 'highlight', settings: { icon: b.settings.icon, text: t(b.settings.text, 80) } })));
        break;
      }
      case 'purchase': {
        const st = sec.settings;
        Object.assign(s, { media_position: st.media_position, gallery_style: st.gallery_style, image_ratio: st.image_ratio, show_breadcrumb: st.show_breadcrumb, show_vendor: st.show_vendor, show_options: st.show_options, show_qty: st.show_qty, description_source: st.description_source, is_above_fold: sec === top });
        put(s, 'title', t(st.title, 90));
        put(s, 'description', rt(st.description, 1400));
        if (st.description_source === 'custom' && !s.description) s.description_source = 'product';
        put(s, 'button_label', t(st.button_label, 30) || 'Add to cart');
        s.title_tag = h1Used ? 'h2' : 'h1';
        h1Used = true;
        if (st.show_rating && facts.rating) Object.assign(s, { show_rating: true, rating_value: String(facts.rating.value), rating_count: String(facts.rating.count) });
        const blocks: TemplateBlock[] = [];
        for (const id of sec.claimIds) {
          const c = claimById.get(id);
          if (c) blocks.push({ type: 'trust', settings: { icon: c.icon, title: t(c.title, 40), ...(c.text ? { text: t(c.text, 80) } : {}) } });
        }
        for (const b of sec.blocks) blocks.push({ type: 'highlight', settings: { icon: b.settings.icon, text: t(b.settings.text, 80) } });
        add('purchase', s, blocks);
        break;
      }
      case 'benefits': {
        const st = sec.settings;
        Object.assign(s, { layout: st.layout, columns: st.columns, card_style: st.card_style, align: st.align });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 500));
        put(s, 'cta_label', t(st.cta_label, 30));
        add('benefits', s, sec.blocks.map((b) => {
          const bs: Settings = { icon: b.settings.icon, title: t(b.settings.title, 60) };
          put(bs, 'text', rt(b.settings.text, 400));
          return { type: 'benefit', settings: bs };
        }));
        break;
      }
      case 'specs': {
        const st = sec.settings;
        s.layout = st.layout;
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 500));
        const blocks: TemplateBlock[] = sec.blocks.map((b) => ({ type: 'note', settings: { title: t(b.settings.title, 40), text: rt(b.settings.text, 500) } }));
        for (const sp of facts.specs.slice(0, sec.maxRows)) blocks.push({ type: 'spec', settings: { label: t(sp.label, 40), value: t(sp.value, 160) } });
        add('specs', s, blocks);
        break;
      }
      case 'faq': {
        const st = sec.settings;
        Object.assign(s, { style: st.style, align: st.align, open_first: st.open_first, schema: true });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 400));
        add('faq', s, sec.blocks.map((b) => ({ type: 'qa', settings: { question: t(b.settings.question, 120), answer: rt(b.settings.answer, 900) } })));
        break;
      }
      case 'gallery': {
        const st = sec.settings;
        Object.assign(s, { source: 'product', limit: st.limit, layout: st.layout, columns: st.columns, image_ratio: st.image_ratio, align: st.align });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 400));
        add('gallery', s);
        break;
      }
      case 'comparison': {
        const st = sec.settings;
        s.align = st.align;
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 400));
        put(s, 'other_label', t(st.other_label, 40) || 'Typical alternative');
        add('comparison', s, sec.blocks.map((b) => ({ type: 'row', settings: { feature: t(b.settings.feature, 50), ours: t(b.settings.ours, 40), other: t(b.settings.other, 40) } })));
        break;
      }
      case 'reviews': {
        const st = sec.settings;
        Object.assign(s, { align: st.align, layout: st.layout, card_style: st.card_style });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 400));
        if (facts.rating) Object.assign(s, { rating_value: String(facts.rating.value), rating_count: String(facts.rating.count), source: t(facts.rating.source, 80) });
        add('reviews', s, facts.reviews.slice(0, sec.maxReviews).map((r) => {
          const bs: Settings = { author: t(r.author, 60), rating: r.rating ?? 0, body: rt(r.body, 1400), verified: !!r.verified };
          put(bs, 'title', t(r.title, 120));
          put(bs, 'date', t(r.date, 40));
          return { type: 'review', settings: bs };
        }));
        break;
      }
      case 'trust': {
        s.density = sec.settings.density;
        put(s, 'heading', t(sec.settings.heading, 60));
        add('trust', s, sec.claimIds.map((id) => {
          const c = claimById.get(id)!;
          const bs: Settings = { icon: c.icon, title: t(c.title, 40) };
          put(bs, 'text', t(c.text, 80));
          return { type: 'badge', settings: bs };
        }));
        break;
      }
      case 'offer': {
        Object.assign(s, { style: sec.settings.style, show_savings: sec.settings.show_savings && facts.hasCompareAt });
        if (facts.offer) {
          put(s, 'text', t(facts.offer.text, 80));
          put(s, 'subtext', rt(facts.offer.subtext, 400));
          put(s, 'code', t(facts.offer.code, 30));
        }
        put(s, 'button_label', t(sec.settings.button_label, 30));
        add('offer', s);
        break;
      }
      case 'story': {
        const st = sec.settings;
        Object.assign(s, { align: st.align, layout: st.layout, image_ratio: st.image_ratio });
        put(s, 'eyebrow', t(st.eyebrow, 40));
        put(s, 'heading', t(st.heading, 90));
        put(s, 'intro', rt(st.intro, 500));
        add('story', s, sec.blocks.map((b) => {
          const bs: Settings = { heading: t(b.settings.heading, 80), text: rt(b.settings.text, 900), use_product_image: b.settings.use_product_image };
          put(bs, 'eyebrow', t(b.settings.eyebrow, 40));
          return { type: 'chapter', settings: bs };
        }));
        break;
      }
    }
  }

  // Sticky ATC last (mobile, appears after primary CTA scrolls away)
  add('sticky', { show_on_desktop: false, button_label: 'Add to cart' });

  const templateSuffix = templateSuffixFor(opts.slug, config.direction, opts.version);
  return { template: out, templateSuffix, fileName: `templates/product.${templateSuffix}.json`, renderedOrder, notes, config };
}
