/**
 * SSRF protection for every outbound request made on behalf of user input (product URLs, competitor URLs).
 *
 *  - Only http/https, ports 80/443, no embedded credentials.
 *  - Hostname must resolve exclusively to public unicast addresses (blocks loopback, private, link-local,
 *    CGNAT, multicast, cloud metadata 169.254.169.254, IPv6 ULA/link-local, IPv4-mapped private, etc.).
 *  - The check runs inside the socket `lookup` hook, so the address that is actually connected is the one
 *    validated (defeats DNS-rebinding / TOCTOU between check and connect).
 *  - Redirects are followed manually and every hop is re-validated.
 *  - Timeouts and a response-size cap bound every request.
 */
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet'];

/** True if the address is safe to connect to (public unicast). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let addr = ipaddr.parse(address);
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  // ipaddr.js range(): 'unicast' is the only acceptable class for both families
  return addr.range() === 'unicast';
}

/** Synchronous structural checks (scheme, port, credentials, obvious internal names, literal IPs). */
export function assertSafeUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`Scheme ${url.protocol} is not allowed`);
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError(`Port ${url.port} is not allowed`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeUrlError('Missing host');
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError(`Host ${host} is not allowed`);
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError(`Address ${host} is not public`);
  } else if (!host.includes('.')) {
    throw new UnsafeUrlError(`Single-label host ${host} is not allowed`);
  }
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup wrapper that refuses non-public results. Used by the undici connector and by Playwright routing. */
export function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '');
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (!list.length || bad) {
      const e = new UnsafeUrlError(`Host ${hostname} resolves to a non-public address${bad ? ` (${bad.address})` : ''}`) as NodeJS.ErrnoException;
      e.code = 'EUNSAFEADDR';
      return cb(e, '');
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

/** Resolve and validate a hostname (async), e.g. before handing a URL to a browser. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError(`Address ${host} is not public`);
    return;
  }
  await new Promise<void>((resolve, reject) =>
    guardedLookup(host, {}, (err) => (err ? reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError(`DNS lookup failed for ${host}: ${err.message}`)) : resolve())),
  );
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  const url = assertSafeUrlShape(raw);
  await assertPublicHost(url.hostname);
  return url;
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 20_000,
});

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  userAgent?: string;
}

export interface SafeFetchResult {
  url: string; // final URL after redirects
  status: number;
  ok: boolean;
  contentType: string;
  body: Buffer;
  text(): string;
  json<T = unknown>(): T;
}

export const DEFAULT_UA = process.env.CRAWL_USER_AGENT || 'LandingPageBuilderBot/0.1 (+research; respects robots.txt)';

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024, maxRedirects = 5 } = opts;
  let current = assertSafeUrlShape(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        // @ts-expect-error undici dispatcher is supported by Node's fetch
        dispatcher: agent,
        headers: {
          'User-Agent': opts.userAgent ?? DEFAULT_UA,
          Accept: opts.accept ?? 'text/html,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        current = assertSafeUrlShape(new URL(res.headers.get('location')!, current).toString()); // re-validated; DNS checked at connect
        continue;
      }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > maxBytes) {
        await res.body?.cancel();
        throw new Error(`Response too large (${declared} bytes)`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > maxBytes) {
            controller.abort();
            throw new Error(`Response exceeded ${maxBytes} bytes`);
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      const body = Buffer.concat(chunks);
      return {
        url: current.toString(),
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get('content-type') ?? '',
        body,
        text: () => body.toString('utf8'),
        json: <T>() => JSON.parse(body.toString('utf8')) as T,
      };
    }
    throw new Error(`Too many redirects (>${maxRedirects})`);
  } catch (e) {
    const err = e as Error & { cause?: Error };
    if (err.cause instanceof UnsafeUrlError) throw err.cause;
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
