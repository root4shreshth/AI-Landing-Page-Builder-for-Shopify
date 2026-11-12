/**
 * In-page measurement script for competitor pages (runs verbatim inside the browser, so it is a string).
 * Returns structural signals only — no copy is retained beyond counts and lengths.
 */
export interface SectionSignal { index: number; top: number; height: number; kind: string }
export interface PageSignals {
  viewport: { w: number; h: number };
  h1: { words: number; hasNumber: boolean; isQuestion: boolean; matchesTitle: boolean } | null;
  sections: SectionSignal[];
  atc: { count: number; firstTop: number | null; aboveFold: boolean };
  price: { top: number | null; hasCompare: boolean; discountBadge: boolean; emi: boolean };
  rating: { present: boolean; top: number | null; nearPrice: boolean };
  faq: { present: boolean; questions: number };
  comparisonTable: boolean;
  specsTable: boolean;
  video: boolean;
  ugc: boolean;
  urgency: boolean;
  bundle: boolean;
  cod: boolean;
  delivery: boolean;
  returns: boolean;
  trustNearAtc: number;
  imageCount: number;
  sizeGuide: boolean;
  iconGrid: boolean;
  pageHeight: number;
}

export const SIGNALS_SCRIPT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const abs = (el) => el.getBoundingClientRect().top + scrollY;
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const body = document.body;
  const bodyText = text(body).slice(0, 200000);
  const title = (document.querySelector('meta[property="og:title"]')?.content || document.title || '').toLowerCase();

  // ---- add to cart ----
  const atcRe = /^(add to (cart|bag|basket)|buy now|add to cart\\s*[-–]?.*)$/i;
  const atcs = Array.from(document.querySelectorAll('button, a, input[type="submit"]')).filter(vis).filter((b) => atcRe.test(text(b) || b.value || '') || b.matches('form[action*="/cart/add"] [type="submit"], [name="add"]'));
  const atcTops = atcs.map(abs).sort((a, b) => a - b);

  // ---- price ----
  const priceEl = Array.from(document.querySelectorAll('[class*="price" i], [data-price], [itemprop="price"]')).filter(vis).find((el) => /(₹|rs\\.?|inr|\\$)\\s?[\\d,]+/i.test(text(el)));
  const priceTop = priceEl ? abs(priceEl) : null;
  const priceZone = priceEl ? text(priceEl.closest('form, [class*="product" i], section') || priceEl).slice(0, 600) : '';
  const hasCompare = !!document.querySelector('s, del, strike, [class*="compare" i], [class*="was-price" i], [class*="strike" i]');
  const discountBadge = /\\b\\d{1,2}\\s?%\\s?off\\b|save\\s?(₹|rs\\.?)?\\s?\\d/i.test(priceZone || bodyText.slice(0, 5000));
  const emi = /\\bemi\\b|no.cost emi|pay in \\d|simpl|snapmint|zest/i.test(priceZone);

  // ---- rating ----
  const ratingEls = Array.from(document.querySelectorAll('[class*="rating" i], [class*="stars" i], [class*="review" i][class*="badge" i], .jdgm-prev-badge, .loox-rating, [data-rating], [aria-label*="star" i]')).filter(vis);
  const ratingTop = ratingEls.length ? Math.min(...ratingEls.map(abs)) : null;
  const ratingText = /\\b[1-5](\\.\\d)?\\s?(★|\\/\\s?5|out of 5|stars?)|\\(\\d{1,6}\\s?reviews?\\)|\\d{1,6}\\s?(ratings|reviews)\\b/i.test(bodyText.slice(0, 20000));

  // ---- sections in visual order ----
  const container = document.querySelector('main') || body;
  let blocks = Array.from(container.children).filter(vis);
  if (blocks.length < 3) blocks = Array.from(container.querySelectorAll(':scope > * > *')).filter(vis);
  const kindOf = (el, i) => {
    const t = text(el).toLowerCase().slice(0, 3000);
    const h = Array.from(el.querySelectorAll('h1,h2,h3')).map(text).join(' ').toLowerCase();
    if (el.querySelector('form[action*="/cart/add"]') || (i === 0 && /add to (cart|bag)/.test(t))) return 'purchase';
    if (/frequently asked|faq|questions/.test(h) || el.querySelectorAll('details').length >= 3) return 'faq';
    if (/review|testimonial|what (our )?customers|rated|loved by/.test(h) || /\\d+ reviews/.test(t.slice(0, 300))) return 'reviews';
    if (/compare|comparison|\\bvs\\.?\\b|why choose|us vs/.test(h) || (el.querySelector('table') && /\\bvs\\b|compare/.test(t))) return 'comparison';
    if (/spec|details|dimension|ingredient|material|features/.test(h) && (el.querySelector('table, dl') || /:/.test(t))) return 'specs';
    if (/you may also like|related|recommended|similar|recently viewed|complete the look|frequently bought/.test(h)) return 'recommendations';
    if (/#\\w+|instagram|as seen|customer photos|community|ugc/.test(h)) return 'ugc';
    if (/story|our (mission|journey)|why we|made (by|for)|crafted|about/.test(h)) return 'story';
    if (/how to use|how it works|steps|ritual/.test(h)) return 'how-to';
    if (el.querySelectorAll('img, svg').length >= 3 && el.querySelectorAll('h3, h4, strong').length >= 3 && t.length < 1500) return 'benefits';
    if (/\\d{1,2}% off|offer|sale|deal|coupon|use code/.test(t.slice(0, 400)) && t.length < 600) return 'offer';
    if (/warranty|secure|guarantee|free (shipping|delivery)|returns?|cod|certified/.test(t) && t.length < 700) return 'trust';
    if (el.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]')) return 'video';
    if (el.querySelectorAll('img').length >= 4 && t.length < 400) return 'gallery';
    if (i === 0 && el.querySelector('img')) return 'hero';
    return 'content';
  };
  const sections = blocks.slice(0, 30).map((el, i) => ({ index: i, top: Math.round(abs(el)), height: Math.round(el.getBoundingClientRect().height), kind: kindOf(el, i) }))
    .filter((s) => s.height > 60);

  // ---- trust near ATC ----
  let trustNearAtc = 0;
  if (atcs[0]) {
    const zone = atcs[0].closest('form, [class*="product" i], section') || atcs[0].parentElement;
    const zt = text(zone).toLowerCase();
    trustNearAtc = ['secure', 'warranty', 'guarantee', 'genuine', 'original', 'free shipping', 'free delivery', 'return', 'exchange', 'cod', 'cash on delivery', 'certified'].filter((k) => zt.includes(k)).length;
  }

  const h1 = Array.from(document.querySelectorAll('h1')).find(vis);
  const h1t = h1 ? text(h1) : '';
  const faqQs = document.querySelectorAll('details summary').length + Array.from(document.querySelectorAll('h3, h4, button')).filter((e) => /\\?\\s*$/.test(text(e))).length;
  const tables = Array.from(document.querySelectorAll('table')).filter(vis);
  return {
    viewport: { w: vw, h: vh },
    h1: h1 ? { words: h1t.split(' ').filter(Boolean).length, hasNumber: /\\d/.test(h1t), isQuestion: /\\?$/.test(h1t), matchesTitle: !!title && title.includes(h1t.toLowerCase().slice(0, 20)) } : null,
    sections,
    atc: { count: atcs.length, firstTop: atcTops.length ? Math.round(atcTops[0]) : null, aboveFold: atcTops.length > 0 && atcTops[0] < vh - 40 },
    price: { top: priceTop == null ? null : Math.round(priceTop), hasCompare, discountBadge, emi },
    rating: { present: ratingEls.length > 0 || ratingText, top: ratingTop == null ? null : Math.round(ratingTop), nearPrice: ratingTop != null && priceTop != null && Math.abs(ratingTop - priceTop) < 260 },
    faq: { present: /frequently asked|\\bfaqs?\\b/i.test(bodyText) || document.querySelectorAll('details').length >= 3, questions: faqQs },
    comparisonTable: tables.some((t) => /\\bvs\\.?\\b|compare|comparison|others/i.test(text(t).slice(0, 300))) || sections.some((s) => s.kind === 'comparison'),
    specsTable: tables.some((t) => t.querySelectorAll('tr').length >= 3) || document.querySelectorAll('dl dt').length >= 3,
    video: !!document.querySelector('main video, main iframe[src*="youtube"], main iframe[src*="vimeo"], video'),
    ugc: /customer photos|as seen on|#\\w{3,}|shop the look|real customers/i.test(bodyText),
    urgency: /only \\d+ (left|in stock)|hurry|selling fast|few (left|units)|ends in|limited (time|stock|period)|\\d+ (people|customers) (bought|are viewing)|low stock/i.test(bodyText),
    bundle: /\\bbundle\\b|\\bcombo\\b|pack of \\d|buy \\d,? get \\d|frequently bought together|\\bkit\\b/i.test(bodyText),
    cod: /cash on delivery|\\bCOD\\b/.test(bodyText),
    delivery: /deliver(y|ed)? (by|in|within)|estimated delivery|check (delivery|pincode)|enter (your )?pin ?code|dispatch(ed)? (in|within)/i.test(bodyText),
    returns: /\\d+[- ]?days? (easy )?(return|exchange)|easy returns|hassle.free return|return policy/i.test(bodyText),
    trustNearAtc,
    imageCount: Array.from(document.querySelectorAll('main img, [class*="gallery" i] img, [class*="media" i] img')).filter(vis).length,
    sizeGuide: /size (chart|guide)/i.test(bodyText),
    iconGrid: sections.some((s) => s.kind === 'benefits'),
    pageHeight: Math.round(document.documentElement.scrollHeight),
  };
})()`;

/** Detects a sticky/fixed add-to-cart after scrolling well past the main one. */
export const STICKY_SCRIPT = `(() => {
  const atcRe = /add to (cart|bag|basket)|buy now/i;
  return Array.from(document.querySelectorAll('body *')).some((el) => {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') return false;
    const r = el.getBoundingClientRect();
    if (r.height < 30 || r.height > innerHeight * 0.4 || r.bottom < 0 || r.top > innerHeight) return false;
    return atcRe.test(el.innerText || '') && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  });
})()`;
