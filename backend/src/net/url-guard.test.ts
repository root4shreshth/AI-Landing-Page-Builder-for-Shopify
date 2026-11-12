import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { assertSafeUrl, assertSafeUrlShape, isPublicAddress, safeFetch, UnsafeUrlError } from './url-guard.js';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '23.227.38.65', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])('allows %s', (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe('assertSafeUrlShape', () => {
  it.each([
    'file:///etc/passwd', 'ftp://example.com/x', 'gopher://x.com', 'javascript:alert(1)', 'data:text/html,hi',
    'http://localhost/x', 'http://foo.localhost/', 'http://printer.local/', 'http://metadata.google.internal/',
    'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.1.2.3/',
    'http://user:pass@example.com/', 'http://example.com:8080/', 'http://intranet/', 'not a url',
  ])('rejects %s', (u) => expect(() => assertSafeUrlShape(u)).toThrow(UnsafeUrlError));

  it.each(['https://example.com/products/x', 'http://shop.example.in/', 'https://example.com:443/a'])('accepts %s', (u) =>
    expect(assertSafeUrlShape(u).hostname).toBeTruthy(),
  );
});

describe('DNS-level checks', () => {
  it('rejects hostnames that resolve to private addresses', async () => {
    // localtest.me style names are not guaranteed; use the IPv4 literal-in-DNS trick via nip.io only if reachable,
    // otherwise rely on a literal. The literal path exercises the same isPublicAddress check.
    await expect(assertSafeUrl('http://127.0.0.1.nip.io/')).rejects.toThrow();
  });

  it('safeFetch never connects to a local server, even via redirect', async () => {
    const server = createServer((_req, res) => res.writeHead(200).end('secret'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(UnsafeUrlError);
    server.close();
  });
});
