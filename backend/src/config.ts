import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const resolveFromRoot = (p: string | undefined, fallback: string) =>
  path.isAbsolute(p ?? '') ? (p as string) : path.resolve(REPO_ROOT, p && p.trim() ? p.replace(/^\.\/?/, '') : fallback);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  storageDir: resolveFromRoot(process.env.STORAGE_DIR, 'storage'),
  llm: {
    main: process.env.LLM_MODEL_MAIN || 'claude-haiku-5-5',
    fast: process.env.LLM_MODEL_FAST || 'claude-haiku-5-5',
    enabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  },
  crawl: {
    maxConcurrency: Math.max(1, Math.min(6, Number(process.env.CRAWL_MAX_CONCURRENCY ?? 3))),
  },
  shopify: {
    store: process.env.SHOPIFY_STORE || '',
    storefrontPassword: process.env.SHOPIFY_STOREFRONT_PASSWORD || '',
  },
};
