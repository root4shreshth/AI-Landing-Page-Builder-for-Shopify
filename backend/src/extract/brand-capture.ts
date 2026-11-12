/**
 * Captures computed styles + screenshots of a product page (desktop 1440x900 and mobile 390x844).
 * Raw observations only; interpretation happens in brand-derive.ts (pure, unit-tested).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { newGuardedContext, openPage } from '../browser/browser.js';

export interface StyleSample {
  bg: string; color: string; fontFamily: string; fontSize: number; fontWeight: number; textTransform: string; letterSpacing: string;
}
export interface ButtonSample extends StyleSample { borderRadius: number; borderColor: string; borderWidth: number; height: number; text: string }
export interface ComputedBrandData {
  body: StyleSample;
  htmlBg: string;
  h1: StyleSample | null;
  h2: StyleSample | null;
  atc: ButtonSample | null;
  buttons: ButtonSample[];
  linkColors: { color: string; count: number }[];
  headerBg: string | null;
  bgAreas: { color: string; area: number }[];
  textColors: { color: string; chars: number }[];
  sectionPaddings: number[];
  headingTexts: string[];
  ctaTexts: string[];
}

export interface BrandCapture {
  desktop: ComputedBrandData;
  mobile: ComputedBrandData | null;
  screenshots: { desktop: string; mobile: string | null };
  desktopPng: Buffer;
  desktopJpeg: Buffer;
  finalUrl: string;
}

/** Runs inside the page. Must be self-contained (no closures over Node variables). */
function collect(): ComputedBrandData {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  const sample = (el: Element) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, fontFamily: s.fontFamily, fontSize: parseFloat(s.fontSize), fontWeight: Number(s.fontWeight) || 400, textTransform: s.textTransform, letterSpacing: s.letterSpacing };
  };
  const btn = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { ...sample(el), borderRadius: parseFloat(s.borderTopLeftRadius) || 0, borderColor: s.borderTopColor, borderWidth: parseFloat(s.borderTopWidth) || 0, height: r.height, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
  };
  const first = (sel: string) => Array.from(document.querySelectorAll(sel)).find(vis) ?? null;

  const atcEl =
    first('form[action*="/cart/add"] [type="submit"]:not([disabled])') ||
    first('form[action*="/cart/add"] button') ||
    first('button[name="add"], [data-add-to-cart], .product-form__submit, .add-to-cart, #AddToCart, button.btn--add-to-cart') ||
    Array.from(document.querySelectorAll('button, a')).filter(vis).find((b) => /add to (cart|bag)|buy now/i.test(b.textContent || '')) ||
    null;
  const buttons = Array.from(document.querySelectorAll('button, a.button, a.btn, .btn, .button, [role="button"]')).filter(vis).slice(0, 25).map(btn);

  const links = new Map<string, number>();
  Array.from(document.querySelectorAll('main a, a')).filter(vis).slice(0, 300).forEach((a) => {
    const c = getComputedStyle(a).color;
    links.set(c, (links.get(c) ?? 0) + 1);
  });

  const header = first('header, .header, #shopify-section-header, [class*="header"]');
  const vw = window.innerWidth;
  const vh = Math.max(window.innerHeight, 1);
  const bgAreas = new Map<string, number>();
  const textColors = new Map<string, number>();
  const all = Array.from(document.body.querySelectorAll('*')).slice(0, 4000);
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top > vh * 4) continue;
    const s = getComputedStyle(el);
    const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh * 4) - Math.max(r.top, 0));
    if (area > 0 && s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) bgAreas.set(s.backgroundColor, (bgAreas.get(s.backgroundColor) ?? 0) + area);
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
    if (own.length > 1) textColors.set(s.color, (textColors.get(s.color) ?? 0) + own.length);
  }
  const paddings = Array.from(document.querySelectorAll('main section, main > div, .shopify-section, section')).filter(vis).slice(0, 20)
    .map((el) => parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom)).filter((n) => n > 0);

  const top = <T,>(m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
  const h1 = first('h1');
  const h2 = first('h2');
  return {
    body: sample(document.body),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    h1: h1 ? sample(h1) : null,
    h2: h2 ? sample(h2) : null,
    atc: atcEl ? btn(atcEl) : null,
    buttons,
    linkColors: top(links, 6).map(([color, count]) => ({ color, count })),
    headerBg: header ? getComputedStyle(header).backgroundColor : null,
    bgAreas: top(bgAreas, 20).map(([color, area]) => ({ color, area })),
    textColors: top(textColors, 12).map(([color, chars]) => ({ color, chars })),
    sectionPaddings: paddings,
    headingTexts: Array.from(document.querySelectorAll('h1, h2, h3')).filter(vis).slice(0, 12).map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean),
    ctaTexts: buttons.map((b) => b.text).filter(Boolean).slice(0, 10),
  };
}

/**
 * Hide modal overlays/interstitials (fixed elements covering >35% of the viewport, e.g. newsletter or
 * "we moved" popups and their dimming scrims) and undo scroll-locks/blur they apply — without clicking.
 * Kept as a string so it runs verbatim in the page.
 */
export const HIDE_OVERLAYS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || s.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (area > vw * vh * 0.35 && !el.matches('header, [class*="header" i]')) el.style.setProperty('display', 'none', 'important');
  }
  for (const el of [document.documentElement, document.body]) {
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('filter', 'none', 'important');
  }
  for (const el of document.querySelectorAll('main, #MainContent, .main-content, [id*="main" i]')) el.style.setProperty('filter', 'none', 'important');
})()`;

async function capture(page: Page): Promise<ComputedBrandData> {
  // Neutralise cookie banners/popups that cover the page, without clicking anything.
  await page.addStyleTag({ content: '[id*="cookie" i],[class*="cookie" i],[class*="popup" i][class*="newsletter" i],[aria-modal="true"]{display:none!important}' }).catch(() => undefined);
  // tsx/esbuild may wrap functions with a __name() helper that doesn't exist in the page; provide a no-op.
  await page.evaluate('globalThis.__name = globalThis.__name || ((t) => t)');
  await page.evaluate(HIDE_OVERLAYS).catch(() => undefined);
  await page.waitForTimeout(300);
  return page.evaluate(collect);
}

export async function captureBrand(url: string, outDir: string): Promise<BrandCapture> {
  await mkdir(outDir, { recursive: true });
  const desktopCtx = await newGuardedContext({ viewport: { width: 1440, height: 900 } });
  let desktop: ComputedBrandData;
  let desktopPng: Buffer;
  let desktopJpeg: Buffer;
  let finalUrl = url;
  try {
    const page = await openPage(desktopCtx, url);
    finalUrl = page.url();
    desktop = await capture(page); // capture() also hides overlays, so screenshots below are clean
    desktopPng = await page.screenshot({ type: 'png' });
    desktopJpeg = await page.screenshot({ type: 'jpeg', quality: 70 });
  } finally {
    await desktopCtx.close();
  }
  const desktopPath = path.join(outDir, 'desktop.jpg');
  await writeFile(desktopPath, desktopJpeg);

  let mobile: ComputedBrandData | null = null;
  let mobilePath: string | null = null;
  const mobileCtx = await newGuardedContext({ viewport: { width: 390, height: 844 }, mobile: true });
  try {
    const page = await openPage(mobileCtx, url);
    mobile = await capture(page);
    mobilePath = path.join(outDir, 'mobile.jpg');
    await writeFile(mobilePath, await page.screenshot({ type: 'jpeg', quality: 70 }));
  } catch {
    // mobile capture is best-effort
  } finally {
    await mobileCtx.close();
  }
  return { desktop, mobile, screenshots: { desktop: desktopPath, mobile: mobilePath }, desktopPng, desktopJpeg, finalUrl };
}
