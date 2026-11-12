/**
 * Shopify CLI wrapper. Runs the CLI's Node entry point with a fixed executable (process.execPath) and an
 * argument array — never a shell — so no user input can be interpreted as a command. Every argument is
 * validated before use. Requires the CLI to be installed and logged in on this machine (`shopify login`).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const STORE_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
export const THEME_ID_RE = /^\d{6,20}$/;

export function findShopifyCli(): string | null {
  const override = process.env.SHOPIFY_CLI_JS;
  if (override && existsSync(override)) return override;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
  for (const dir of dirs) {
    for (const rel of [['node_modules', '@shopify', 'cli', 'bin', 'run.js'], ['..', 'lib', 'node_modules', '@shopify', 'cli', 'bin', 'run.js']]) {
      const candidate = path.resolve(dir, ...rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export interface CliResult { code: number; stdout: string; stderr: string; json: unknown | null }

/** Run `shopify <args>` with a timeout. `args` must already be validated. */
export function runShopify(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<CliResult> {
  const cli = findShopifyCli();
  if (!cli) return Promise.reject(new Error('Shopify CLI not found. Install it with: npm install -g @shopify/cli'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: opts.cwd, shell: false, windowsHide: true, env: { ...process.env, CI: '1', SHOPIFY_CLI_NO_ANALYTICS: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Shopify CLI timed out after ${Math.round((opts.timeoutMs ?? 300_000) / 1000)}s`));
    }, opts.timeoutMs ?? 300_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // --json output: the final JSON object is the last {...} block on stdout
      let json: unknown = null;
      const start = stdout.lastIndexOf('\n{');
      const chunk = start >= 0 ? stdout.slice(start + 1) : stdout.trim().startsWith('{') ? stdout.trim() : '';
      try {
        json = chunk ? JSON.parse(chunk) : null;
      } catch {
        json = null;
      }
      resolve({ code: code ?? 1, stdout, stderr, json });
    });
  });
}
