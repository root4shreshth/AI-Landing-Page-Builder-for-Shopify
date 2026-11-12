import sanitizeHtml from 'sanitize-html';

/** Strip Liquid delimiters so generated values can never be interpreted as Liquid anywhere. */
const noLiquid = (s: string) => s.replace(/\{\{|\}\}|\{%|%\}/g, '');

/** Plain-text setting: no tags, collapsed whitespace, bounded length. */
export function cleanText(input: string | undefined, max: number): string {
  if (!input) return '';
  const stripped = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
  // sanitize-html entity-encodes; decode the common ones back since Liquid escapes on output
  const decoded = stripped.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return noLiquid(decoded).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Shopify `richtext` setting value: top-level <p>/<ul>/<ol> only, inline strong/em/a/br.
 * Links limited to http(s)/mailto/relative. Returns '' for empty content.
 */
export function cleanRichtext(input: string | undefined, max: number): string {
  if (!input) return '';
  let html = sanitizeHtml(noLiquid(input), {
    allowedTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { b: 'strong', i: 'em', h1: 'p', h2: 'p', h3: 'p', h4: 'p', div: 'p' },
  }).trim();
  if (!html) return '';
  if (!/^<(p|ul|ol)[\s>]/.test(html)) html = `<p>${html}</p>`;
  // Merge stray inline content between top-level blocks into paragraphs
  html = html.replace(/<\/(p|ul|ol)>\s*([^<\s][^<]*)(?=<(p|ul|ol)[\s>]|$)/g, (_m, tag, text) => `</${tag}><p>${text.trim()}</p>`);
  if (html.length > max) {
    // Truncate on plain text to keep markup valid
    const text = cleanText(html, max - 8);
    html = `<p>${text}</p>`;
  }
  return html;
}
