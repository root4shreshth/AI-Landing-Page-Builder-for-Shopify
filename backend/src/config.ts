import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const resolveFromRoot = (p: string | undefined, fallback: string) =>
  path.isAbsolute(p ?? '') ? (p as string) : path.resolve(REPO_ROOT, p && p.trim() ? p.replace(/^\.\/?/, '') : fallback);

export const config = {
  port: Number(process.env.PORT ?? 4100),
  storageDir: resolveFromRoot(process.env.STORAGE_DIR, 'storage'),
  llm: {
    main: process.env.LLM_MODEL_MAIN || 'claude-haiku-5-5',
    fast: process.env.LLM_MODEL_FAST || 'claude-haiku-5-5',
    enabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
  crawl: {
    maxConcurrency: Math.max(1, Math.min(6, Number(process.env.CRAWL_MAX_CONCURRENCY ?? 3))),
  },
  /** Hosted deployments: shared access password, LLM-spend caps, small-instance mode. */
  access: {
    password: process.env.APP_PASSWORD || '',
    runsPerClientHour: Math.max(1, Number(process.env.MAX_RUNS_PER_CLIENT_HOUR ?? 6)),
    runsPerHour: Math.max(1, Number(process.env.MAX_RUNS_PER_HOUR ?? 20)),
  },
  /** LOW_MEMORY=1: close Chromium between stages and keep one browser page at a time (512 MB hosts). */
  lowMemory: /^(1|true|yes)$/i.test(process.env.LOW_MEMORY ?? ''),
  /** LIGHTHOUSE=off skips Lighthouse (it needs a second full Chrome) and says so in the checks. */
  lighthouse: !/^(0|off|false|no)$/i.test(process.env.LIGHTHOUSE ?? ''),
  shopify: {
    store: process.env.SHOPIFY_STORE || '',
    storefrontPassword: process.env.SHOPIFY_STOREFRONT_PASSWORD || '',
  },
};
