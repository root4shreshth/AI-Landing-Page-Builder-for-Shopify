/**
 * Access control for a hosted deployment.
 *  - accessGate: one shared password (HTTP Basic, any username) in front of the dashboard, API and files.
 *    The browser asks once and then sends it with every request, including iframes and the SSE stream.
 *    Loopback requests without a proxy header are let through: those are the app's own browser checks
 *    and Lighthouse loading /files previews from localhost.
 *  - hourlyLimit: caps actions that spend LLM credits (new runs, regenerations), per client and overall.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

function isLocalSelfRequest(req: Request) {
  const ip = req.socket.remoteAddress ?? '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return loopback && !req.headers['x-forwarded-for'];
}

export function accessGate(password: string) {
  const want = sha(password);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/health' || isLocalSelfRequest(req)) return next();
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (timingSafeEqual(sha(given), want)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Landing Page Builder", charset="UTF-8"');
    res.status(401).type('text/plain').send('Password required. Ask the owner of this deployment for the access password.');
  };
}

export function hourlyLimit(opts: { perClient: number; total: number }) {
  const hits: { at: number; key: string }[] = [];
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    while (hits.length && now - hits[0].at > 3_600_000) hits.shift();
    const key = req.ip ?? 'unknown';
    const mine = hits.filter((h) => h.key === key).length;
    if (mine >= opts.perClient || hits.length >= opts.total) {
      const retryMin = Math.max(1, Math.ceil((3_600_000 - (now - (hits.find((h) => h.key === key) ?? hits[0]).at)) / 60_000));
      res.set('Retry-After', String(retryMin * 60));
      return res.status(429).json({ error: `Run limit reached on this deployment (${mine >= opts.perClient ? `${opts.perClient} per visitor` : `${opts.total} in total`} per hour). Try again in about ${retryMin} min.` });
    }
    hits.push({ at: now, key });
    next();
  };
}
