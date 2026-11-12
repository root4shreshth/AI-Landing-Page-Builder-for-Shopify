/**
 * robots.txt compliance + polite per-domain rate limiting for all crawling.
 * Policy: 2xx -> obey rules; 404/410 (no robots) -> allowed; 401/403 -> disallowed;
 * 5xx / network error -> disallowed (treat the site as temporarily unavailable, like Google does).
 */
import robotsParserModule from 'robots-parser';
import { DEFAULT_UA, safeFetch } from './url-guard.js';

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
// robots-parser is CommonJS with a broken `declare module` typing; give it an explicit signature.
const robotsParser = robotsParserModule as unknown as (url: string, body: string) => Robots;
interface CacheEntry { robots: Robots | null; policy: 'rules' | 'allow_all' | 'disallow_all'; fetchedAt: number; crawlDelayMs: number }

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000;
const UA_TOKEN = 'LandingPageBuilderBot';

async function load(origin: string): Promise<CacheEntry> {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  const robotsUrl = `${origin}/robots.txt`;
  let entry: CacheEntry;
  try {
    const res = await safeFetch(robotsUrl, { timeoutMs: 8_000, maxBytes: 512 * 1024, accept: 'text/plain' });
    if (res.ok) {
      const robots = robotsParser(robotsUrl, res.text());
      const delay = robots.getCrawlDelay(UA_TOKEN) ?? robots.getCrawlDelay('*');
      entry = { robots, policy: 'rules', fetchedAt: Date.now(), crawlDelayMs: Math.min(10_000, (delay ?? 0) * 1000) };
    } else if (res.status === 404 || res.status === 410) {
      entry = { robots: null, policy: 'allow_all', fetchedAt: Date.now(), crawlDelayMs: 0 };
    } else {
      entry = { robots: null, policy: 'disallow_all', fetchedAt: Date.now(), crawlDelayMs: 0 };
    }
  } catch {
    entry = { robots: null, policy: 'disallow_all', fetchedAt: Date.now(), crawlDelayMs: 0 };
  }
  cache.set(origin, entry);
  return entry;
}

export interface RobotsDecision { allowed: boolean; reason: string; crawlDelayMs: number }

export async function checkRobots(rawUrl: string, userAgent = DEFAULT_UA): Promise<RobotsDecision> {
  const url = new URL(rawUrl);
  const entry = await load(url.origin);
  if (entry.policy === 'allow_all') return { allowed: true, reason: 'no robots.txt', crawlDelayMs: 0 };
  if (entry.policy === 'disallow_all') return { allowed: false, reason: 'robots.txt unavailable (treated as disallow)', crawlDelayMs: 0 };
  const allowed = entry.robots!.isAllowed(url.toString(), userAgent) ?? true;
  return { allowed, reason: allowed ? 'allowed by robots.txt' : 'disallowed by robots.txt', crawlDelayMs: entry.crawlDelayMs };
}

// ---- polite per-domain spacing ----
const lastHit = new Map<string, number>();
const MIN_INTERVAL_MS = 1500;

/** Wait so requests to one host are at least max(MIN_INTERVAL, crawl-delay) apart. */
export async function politeWait(rawUrl: string, crawlDelayMs = 0): Promise<void> {
  const host = new URL(rawUrl).host;
  const gap = Math.max(MIN_INTERVAL_MS, crawlDelayMs);
  const now = Date.now();
  const next = (lastHit.get(host) ?? 0) + gap;
  lastHit.set(host, Math.max(now, next));
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

export function _resetRobotsCache() {
  cache.clear();
  lastHit.clear();
}
