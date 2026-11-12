/**
 * Store claims (COD, returns, free shipping, delivery time, made in India) detected in the source page text.
 * Each claim carries the exact supporting snippet as evidence and must be confirmed by the user in the
 * dashboard before it counts as verified. Negated mentions ("COD not available") are ignored.
 */
import type { ProductFacts } from '../catalogue/facts.js';

type Claim = ProductFacts['claims'][number];

const NEGATION = /\b(no|not|non|unavailable|isn'?t|aren'?t|cannot|can'?t|don'?t|doesn'?t|without|excluding)\b/i;

function snippet(text: string, index: number, len: number) {
  const start = Math.max(0, index - 40);
  return text.slice(start, Math.min(text.length, index + len + 60)).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function negated(text: string, index: number, len: number) {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + len, index + len + 25);
  return NEGATION.test(before) || /^\W*(is\s+)?(not|unavailable|n'?t)\b/i.test(after);
}

export function extractClaims(pageText: string, opts: { isShopify: boolean }): Claim[] {
  const text = pageText.replace(/\s+/g, ' ');
  const claims: Claim[] = [];
  const add = (c: Claim) => {
    if (!claims.some((x) => x.id === c.id)) claims.push(c);
  };
  const firstPositive = (re: RegExp) => {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      if (!negated(text, m.index!, m[0].length)) return m;
    }
    return null;
  };

  // "cash on delivery" in any case; "COD" only in capitals (avoids "cod" the fish / "code")
  const cod = firstPositive(/\b[Cc][Aa][Ss][Hh][\s-]+[Oo][Nn][\s-]+[Dd][Ee][Ll][Ii][Vv][Ee][Rr][Yy]\b|\bCOD\b/);
  if (cod) add({ id: 'cod', icon: 'cash', title: 'Cash on delivery', source: 'source page text', evidence: snippet(text, cod.index!, cod[0].length) });

  const ret = firstPositive(/\b(\d{1,2})[\s-]*days?\s+(?:easy\s+|free\s+|hassle[\s-]free\s+)?(returns?|exchanges?|return\s*(?:&|and)\s*exchanges?)\b/i);
  if (ret) {
    const kind = /exchange/i.test(ret[2]) && !/return/i.test(ret[2]) ? 'exchange' : 'returns';
    add({ id: 'returns', icon: 'return', title: `${ret[1]}-day ${kind}`.slice(0, 40), source: 'source page text', evidence: snippet(text, ret.index!, ret[0].length) });
  }

  const ship = firstPositive(/\bfree\s+(?:shipping|delivery)\b(?:\s+(?:on|above|over|for)\s+(?:all\s+)?(?:orders?\s+)?(?:above\s+|over\s+)?((?:₹|rs\.?|inr)\s?[\d,]+))?/i);
  if (ship) {
    add({ id: 'free_shipping', icon: 'truck', title: 'Free shipping', text: ship[1] ? `On orders above ${ship[1].replace(/\s+/g, ' ')}` : undefined, source: 'source page text', evidence: snippet(text, ship.index!, ship[0].length) });
  }

  const del = firstPositive(/\b(?:delivery|delivered|ships?|dispatch(?:ed)?)\s+(?:in|within)\s+(\d{1,2}\s*(?:-|–|to)\s*\d{1,2}|\d{1,2})\s+(?:business\s+|working\s+)?days\b/i);
  if (del) add({ id: 'delivery_time', icon: 'clock', title: `Delivery in ${del[1].replace(/\s*(?:to|–|-)\s*/, '–')} days`.slice(0, 40), source: 'source page text', evidence: snippet(text, del.index!, del[0].length) });

  const mii = firstPositive(/\bmade\s+in\s+india\b/i);
  if (mii) add({ id: 'made_in_india', icon: 'award', title: 'Made in India', source: 'source page text', evidence: snippet(text, mii.index!, mii[0].length) });

  // Platform fact, not a marketing claim: Shopify processes checkout over HTTPS.
  if (opts.isShopify) add({ id: 'secure_checkout', icon: 'lock', title: 'Secure checkout', text: 'Payments processed by Shopify', source: 'platform (Shopify checkout)' });

  return claims;
}
