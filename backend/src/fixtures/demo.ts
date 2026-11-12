/**
 * M1 fixtures: hand-written page configs for the 4 directions, used to exercise the section library,
 * renderer and previews before the AI pipeline exists.
 *
 * `demoFacts` contains only claims that are true for any Shopify store (checkout security) and specs
 * that would come from a product description — safe to deploy to the dev store.
 * `fixtureFactsWithReviews` adds SAMPLE reviews/rating purely to test the reviews section locally;
 * it must never be deployed (see isFixtureOnly).
 */
import type { BrandTokens } from '../catalogue/brand.js';
import type { ProductFacts } from '../catalogue/facts.js';
import type { PageConfigInput } from '../catalogue/page-config.js';
import type { ProductSnapshot } from '../catalogue/product.js';

/** Offline placeholder product photos (flat SVGs) so local previews and tests need no network images. */
const svgImg = (label: string, bg: string, w = 1200, h = 1200) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/><path d="M${w * 0.32} ${h * 0.28} l${w * 0.12} -${h * 0.06} q${w * 0.06} ${h * 0.05} ${w * 0.12} 0 l${w * 0.12} ${h * 0.06} l-${w * 0.05} ${h * 0.12} l-${w * 0.05} -${h * 0.02} v${h * 0.4} h-${w * 0.24} v-${h * 0.4} l-${w * 0.05} ${h * 0.02} z" fill="#ffffff" opacity="0.85"/><text x="50%" y="${h * 0.9}" font-family="sans-serif" font-size="${w * 0.04}" fill="#ffffff" text-anchor="middle">${label}</text></svg>`,
  );

export const demoProduct: ProductSnapshot = {
  handle: 'organic-cotton-crew-t-shirt',
  title: 'Organic Cotton Crew T-Shirt',
  vendor: 'Demo Brand',
  descriptionHtml: '<p>A midweight crew neck t-shirt made from 100% organic cotton.</p>',
  url: '/products/organic-cotton-crew-t-shirt',
  currency: 'INR',
  moneyFormat: 'Rs. {{amount}}',
  images: [
    { src: svgImg('Front', '#7A8B99'), alt: 'Organic cotton crew t-shirt, front view', width: 1200, height: 1200 },
    { src: svgImg('Back', '#5E6E7B'), alt: 'Organic cotton crew t-shirt, back view', width: 1200, height: 1200 },
    { src: svgImg('Detail', '#A1907A'), alt: 'Close-up of the organic cotton fabric', width: 1200, height: 1200 },
    { src: svgImg('Worn', '#8C7B6B'), alt: 'T-shirt worn with jeans', width: 1200, height: 1500 },
    { src: svgImg('Folded', '#6B7F6B'), alt: 'Folded t-shirt', width: 1200, height: 1200 },
  ],
  options: ['Size', 'Colour'],
  variants: [
    { id: 1001, title: 'S / Navy', options: ['S', 'Navy'], price: 79900, compareAtPrice: 99900, available: true, sku: 'TEE-S-NVY' },
    { id: 1002, title: 'M / Navy', options: ['M', 'Navy'], price: 79900, compareAtPrice: 99900, available: true, sku: 'TEE-M-NVY' },
    { id: 1003, title: 'L / Navy', options: ['L', 'Navy'], price: 79900, compareAtPrice: 99900, available: false, sku: 'TEE-L-NVY' },
    { id: 1004, title: 'S / Sand', options: ['S', 'Sand'], price: 84900, compareAtPrice: null, available: true, sku: 'TEE-S-SND' },
    { id: 1005, title: 'M / Sand', options: ['M', 'Sand'], price: 84900, compareAtPrice: null, available: true, sku: 'TEE-M-SND' },
  ],
  collection: { title: 'T-Shirts', url: '/collections/t-shirts' },
};

export const demoBrand: BrandTokens = {
  colors: { primary: '#17324D', secondary: '#E9B76B', background: '#FFFFFF', text: '#1B1B1B', button: '#17324D', buttonText: '#FFFFFF' },
  fonts: { heading: 'playfair_display_n7', body: 'assistant_n4' },
  radiusPx: 8,
  tone: ['premium', 'warm'],
};

export const demoFacts: ProductFacts = {
  title: 'Organic Cotton Crew T-Shirt',
  vendor: 'Demo Brand',
  brandName: 'Demo Brand',
  category: 'apparel/t-shirts',
  descriptionText: 'A midweight crew neck t-shirt made from 100% organic cotton.',
  hasCompareAt: true,
  reviews: [],
  specs: [
    { label: 'Material', value: '100% organic cotton', source: 'dom' },
    { label: 'Fabric weight', value: '180 GSM', source: 'dom' },
    { label: 'Fit', value: 'Regular fit', source: 'dom' },
    { label: 'Neck', value: 'Crew neck', source: 'dom' },
    { label: 'Care', value: 'Machine wash cold, tumble dry low', source: 'dom' },
  ],
  claims: [{ id: 'secure_checkout', icon: 'lock', title: 'Secure checkout', text: 'Payments processed by Shopify', source: 'platform' }],
};

export const fixtureFactsWithReviews: ProductFacts & { isFixtureOnly: true } = {
  ...demoFacts,
  isFixtureOnly: true,
  rating: { value: 4.6, count: 128, source: 'FIXTURE — sample data for local tests only' },
  reviews: [
    { author: 'Sample A.', rating: 5, title: 'Fixture review', body: 'Sample review text used only to test layout.', verified: true },
    { author: 'Sample B.', rating: 4, body: 'Second sample review used only to test layout.' },
    { author: 'Sample C.', rating: 5, body: 'Third sample review used only to test layout.' },
  ],
  claims: [
    ...demoFacts.claims,
    { id: 'cod', icon: 'cash', title: 'Cash on delivery', source: 'FIXTURE' },
    { id: 'returns', icon: 'return', title: '7-day returns', source: 'FIXTURE' },
  ],
  offer: { text: 'Fixture offer headline', code: 'FIXTURE10', source: 'FIXTURE' },
};

const faqBlocks = [
  { type: 'qa' as const, settings: { question: 'What is the t-shirt made of?', answer: '<p>It is made from 100% organic cotton with a 180 GSM midweight fabric.</p>' } },
  { type: 'qa' as const, settings: { question: 'How does it fit?', answer: '<p>It has a regular fit. If you are between sizes, choose your usual size.</p>' } },
  { type: 'qa' as const, settings: { question: 'How should I wash it?', answer: '<p>Machine wash cold and tumble dry low to keep its shape.</p>' } },
  { type: 'qa' as const, settings: { question: 'What neckline does it have?', answer: '<p>It has a classic crew neck.</p>' } },
];

export const demoConfigs: PageConfigInput[] = [
  {
    designName: 'Editorial Story',
    direction: 'story-led',
    visual: { colorStrategy: 'warm', radius: 'soft', density: 'airy', accent: 'primary' },
    sections: [
      {
        type: 'hero',
        settings: { layout: 'overlay', heading: 'The everyday tee, made the slow way', eyebrow: 'Organic cotton', subheading: '<p>A midweight crew neck in 100% organic cotton.</p>', scrim: 45 },
        blocks: [{ type: 'highlight', settings: { icon: 'leaf', text: '100% organic cotton' } }, { type: 'highlight', settings: { icon: 'feather', text: '180 GSM midweight fabric' } }],
      },
      {
        type: 'story',
        settings: { heading: 'Why we made it', layout: 'alternate', image_ratio: 'landscape' },
        blocks: [
          { type: 'chapter', settings: { eyebrow: 'The fabric', heading: 'Organic cotton, nothing else', text: '<p>Made from 100% organic cotton for a soft, breathable feel.</p>' } },
          { type: 'chapter', settings: { eyebrow: 'The weight', heading: 'Midweight at 180 GSM', text: '<p>Substantial enough to hold its shape, light enough for every day.</p>' } },
        ],
      },
      { type: 'benefits', settings: { heading: 'What makes it different', layout: 'list', card_style: 'plain' }, blocks: [
        { type: 'benefit', settings: { icon: 'leaf', title: 'Organic cotton', text: '<p>100% organic cotton fabric.</p>' } },
        { type: 'benefit', settings: { icon: 'ruler', title: 'Regular fit', text: '<p>A classic regular fit with a crew neck.</p>' } },
        { type: 'benefit', settings: { icon: 'droplet', title: 'Easy care', text: '<p>Machine wash cold, tumble dry low.</p>' } },
      ] },
      { type: 'gallery', settings: { heading: 'In detail', layout: 'mosaic', columns: '3', limit: 5 } },
      { type: 'faq', settings: { heading: 'Good to know', style: 'split' }, blocks: faqBlocks },
    ],
  },
  {
    designName: 'Quick-Scan Grid',
    direction: 'benefit-grid',
    visual: { colorStrategy: 'banded', radius: 'sharp', density: 'compact', accent: 'primary' },
    sections: [
      { type: 'hero', settings: { layout: 'split', media_position: 'left', image_ratio: 'square', heading: 'Organic Cotton Crew T-Shirt', subheading: '<p>100% organic cotton · 180 GSM · Regular fit</p>' }, blocks: [] },
      { type: 'benefits', settings: { heading: 'At a glance', layout: 'grid', columns: '4', card_style: 'outline', align: 'center' }, blocks: [
        { type: 'benefit', settings: { icon: 'leaf', title: 'Organic cotton' } },
        { type: 'benefit', settings: { icon: 'feather', title: '180 GSM' } },
        { type: 'benefit', settings: { icon: 'ruler', title: 'Regular fit' } },
        { type: 'benefit', settings: { icon: 'droplet', title: 'Machine washable' } },
      ] },
      { type: 'specs', settings: { heading: 'Specifications', layout: 'split' }, maxRows: 10, blocks: [] },
      { type: 'comparison', settings: { heading: 'How it compares', other_label: 'Typical basic tee' }, blocks: [
        { type: 'row', settings: { feature: 'Organic cotton', ours: 'yes', other: 'no' } },
        { type: 'row', settings: { feature: 'Fabric weight', ours: '180 GSM', other: 'Varies' } },
        { type: 'row', settings: { feature: 'Machine washable', ours: 'yes', other: 'yes' } },
      ] },
      { type: 'trust', settings: { density: 'compact' }, claimIds: ['secure_checkout'] },
      { type: 'faq', settings: { heading: 'FAQ', style: 'lines' }, blocks: faqBlocks },
    ],
  },
  {
    designName: 'Proof First',
    direction: 'social-proof',
    visual: { colorStrategy: 'light', radius: 'round', density: 'balanced', accent: 'secondary' },
    sections: [
      { type: 'purchase', settings: { gallery_style: 'strip', show_rating: true, description_source: 'custom', description: '<p>A midweight crew neck t-shirt in 100% organic cotton.</p>' }, claimIds: ['secure_checkout', 'cod', 'returns'], blocks: [] },
      { type: 'reviews', settings: { heading: 'What customers say', layout: 'wall' }, maxReviews: 6 },
      { type: 'gallery', settings: { heading: 'Worn every day', layout: 'grid', columns: '4' } },
      { type: 'benefits', settings: { heading: 'Why it gets worn on repeat', columns: '3' }, blocks: [
        { type: 'benefit', settings: { icon: 'leaf', title: 'Organic cotton', text: '<p>100% organic cotton.</p>' } },
        { type: 'benefit', settings: { icon: 'feather', title: 'Midweight', text: '<p>180 GSM fabric.</p>' } },
        { type: 'benefit', settings: { icon: 'droplet', title: 'Easy care', text: '<p>Machine wash cold.</p>' } },
      ] },
      { type: 'faq', settings: { heading: 'Questions', style: 'cards', align: 'center' }, blocks: faqBlocks },
    ],
  },
  {
    designName: 'Offer Up Front',
    direction: 'offer-led',
    visual: { colorStrategy: 'contrast', radius: 'brand', density: 'balanced', accent: 'secondary' },
    sections: [
      { type: 'hero', settings: { layout: 'stacked', heading: 'Organic cotton tee, now at a lower price', image_ratio: 'landscape' }, blocks: [{ type: 'highlight', settings: { icon: 'tag', text: 'Price shown includes current savings' } }] },
      { type: 'offer', settings: { style: 'bar', show_savings: true } },
      { type: 'trust', settings: { density: 'roomy' }, claimIds: ['secure_checkout', 'made_up_claim'] },
      { type: 'specs', settings: { heading: 'The facts', layout: 'stacked' }, maxRows: 6, blocks: [] },
      { type: 'faq', settings: { heading: 'Before you buy', style: 'lines' }, blocks: faqBlocks },
    ],
  },
];
