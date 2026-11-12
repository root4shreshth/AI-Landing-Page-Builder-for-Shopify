/**
 * Specifications ("Label: value") and highlights (unlabelled bullets) from product description HTML.
 * Deterministic parsing — the LLM never invents specs.
 */
import * as cheerio from 'cheerio';
import type { ProductFacts } from '../catalogue/facts.js';

type Spec = ProductFacts['specs'][number];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s•·\-–—*]+/, '').trim();
const LABEL_MAX_WORDS = 5;

function splitLabelValue(text: string): [string, string] | null {
  const m = text.match(/^([^:|]{2,40}?)\s*[:|]\s*(.{1,160})$/) ?? text.match(/^([A-Za-z][^–—-]{1,38}?)\s+[–—-]\s+(.{1,160})$/);
  if (!m) return null;
  const label = clean(m[1]);
  const value = clean(m[2]);
  if (!label || !value || label.split(' ').length > LABEL_MAX_WORDS || /[.!?]$/.test(label)) return null;
  if (/^https?$/i.test(label)) return null;
  return [label, value];
}

/**
 * Spec tables / definition lists elsewhere on the product page (accordions, "Specifications" tabs).
 * Only structured markup is used (never free text), and the page's header/footer/nav are excluded.
 */
export function extractPageSpecTables(pageHtml: string): Spec[] {
  const $ = cheerio.load(pageHtml);
  $('header, footer, nav, script, style, noscript, [role="navigation"], .cart-drawer, #CartDrawer').remove();
  const scope = $('main').length ? $('main') : $('body');
  const fragment = scope.find('table, dl').map((_, el) => $.html(el)).get().join('\n');
  return extractSpecs(fragment).specs;
}

export function extractSpecs(descriptionHtml: string): { specs: Spec[]; highlights: string[] } {
  const $ = cheerio.load(descriptionHtml || '');
  const specs: Spec[] = [];
  const highlights: string[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string) => {
    const key = label.toLowerCase();
    if (seen.has(key) || specs.length >= 25) return;
    seen.add(key);
    specs.push({ label: label.slice(0, 40), value: value.slice(0, 160), source: 'dom' });
  };

  // tables
  $('tr').each((_, tr) => {
    const cells = $(tr).find('th,td').map((__, c) => clean($(c).text())).get().filter(Boolean);
    if (cells.length === 2 && cells[0].split(' ').length <= LABEL_MAX_WORDS) push(cells[0].replace(/:$/, ''), cells[1]);
  });
  // definition lists
  $('dt').each((_, dt) => {
    const dd = $(dt).next('dd');
    if (dd.length) push(clean($(dt).text()).replace(/:$/, ''), clean(dd.text()));
  });
  // list items and lines
  const lines: string[] = [];
  $('li').each((_, li) => { lines.push(clean($(li).text())); });
  $('p').each((_, p) => {
    const html = $(p).html() ?? '';
    for (const part of html.split(/<br\s*\/?>/i)) lines.push(clean(cheerio.load(part).root().text()));
  });
  for (const line of lines) {
    if (!line) continue;
    const lv = splitLabelValue(line);
    if (lv) push(lv[0], lv[1]);
    else if (line.length >= 8 && line.length <= 160 && $('li').length && highlights.length < 10 && !highlights.includes(line)) {
      // only treat as a highlight if it came from a bullet list
      if ($('li').filter((__, li) => clean($(li).text()) === line).length) highlights.push(line);
    }
  }
  return { specs, highlights };
}
