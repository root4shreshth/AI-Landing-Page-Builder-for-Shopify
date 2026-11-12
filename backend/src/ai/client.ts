/**
 * Anthropic client + per-run usage/cost accounting.
 * Credentials come from the environment (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL); never hardcoded.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!config.llm.enabled) throw new Error('LLM is not configured: set ANTHROPIC_API_KEY in backend/.env');
  if (!client) {
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim() || undefined; // empty string must not override the default
    client = new Anthropic({ baseURL, maxRetries: 2, timeout: 90_000 });
  }
  return client;
}

/** USD per 1M tokens (input, output). Used for the per-run cost estimate shown in the dashboard. */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

export interface UsageEntry { step: string; model: string; inputTokens: number; outputTokens: number; usd: number }

export class UsageTracker {
  entries: UsageEntry[] = [];
  add(step: string, model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
    const [pin, pout] = PRICES[model] ?? [0, 0];
    const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
    const usd = (input * pin + usage.output_tokens * pout) / 1_000_000;
    this.entries.push({ step, model, inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), outputTokens: usage.output_tokens, usd });
  }
  get total() {
    return this.entries.reduce((a, e) => ({ inputTokens: a.inputTokens + e.inputTokens, outputTokens: a.outputTokens + e.outputTokens, usd: a.usd + e.usd }), { inputTokens: 0, outputTokens: 0, usd: 0 });
  }
  toJSON() {
    return { ...this.total, entries: this.entries };
  }
}

/** Wrap scraped text so the model treats it as data. Strips anything that looks like our own delimiters. */
export function untrusted(label: string, text: string, max = 4000): string {
  const clean = text.replace(/<\/?untrusted[^>]*>/gi, '').slice(0, max);
  return `<untrusted source="${label}">\n${clean}\n</untrusted>`;
}
