/**
 * Web search adapter for competitor discovery. Providers (first configured wins with SEARCH_PROVIDER=auto):
 * Serper (Google), Tavily, Brave. Without any key, discovery is skipped and the user supplies URLs.
 * Requests go only to the fixed provider endpoints below; keys come from the environment.
 */
export interface SearchResult { title: string; url: string; snippet: string; position: number; query: string; provider: string }
export type SearchProvider = 'serper' | 'tavily' | 'brave';

export function activeProvider(): SearchProvider | null {
  const pref = (process.env.SEARCH_PROVIDER || 'auto').toLowerCase();
  const has: Record<SearchProvider, boolean> = {
    serper: !!process.env.SERPER_API_KEY,
    tavily: !!process.env.TAVILY_API_KEY,
    brave: !!process.env.BRAVE_API_KEY,
  };
  if (pref !== 'auto') return (has as Record<string, boolean>)[pref] ? (pref as SearchProvider) : null;
  return (['serper', 'tavily', 'brave'] as const).find((p) => has[p]) ?? null;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if ((e as { retryable?: boolean }).retryable === false) break; // e.g. bad key / no credits: retrying won't help
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const detail = await res.text().then((t) => { try { return (JSON.parse(t) as { message?: string; detail?: string }).message ?? t; } catch { return t; } }).catch(() => '');
    const err = new Error(`${new URL(url).host} returned HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 120)}` : ''}`);
    (err as Error & { retryable?: boolean }).retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function webSearch(query: string, num = 10): Promise<SearchResult[]> {
  const provider = activeProvider();
  if (!provider) return [];
  return withRetry(async () => {
    switch (provider) {
      case 'serper': {
        const data = await postJson('https://google.serper.dev/search', { 'X-API-KEY': process.env.SERPER_API_KEY! }, { q: query, gl: 'in', hl: 'en', num });
        return ((data.organic as { title: string; link: string; snippet?: string; position?: number }[]) ?? []).map((r, i) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '', position: r.position ?? i + 1, query, provider }));
      }
      case 'tavily': {
        const data = await postJson('https://api.tavily.com/search', { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, { query, max_results: num, search_depth: 'basic' });
        return ((data.results as { title: string; url: string; content?: string }[]) ?? []).map((r, i) => ({ title: r.title, url: r.url, snippet: r.content ?? '', position: i + 1, query, provider }));
      }
      case 'brave': {
        const u = new URL('https://api.search.brave.com/res/v1/web/search');
        u.searchParams.set('q', query);
        u.searchParams.set('country', 'in');
        u.searchParams.set('count', String(num));
        const res = await fetch(u, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY! }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Brave returned HTTP ${res.status}`);
        const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
        return (data.web?.results ?? []).map((r, i) => ({ title: r.title, url: r.url, snippet: r.description ?? '', position: i + 1, query, provider }));
      }
    }
  });
}
