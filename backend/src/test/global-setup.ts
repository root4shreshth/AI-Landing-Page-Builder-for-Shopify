// Builds the theme ONCE before any test file runs (test files run in parallel and must not
// rebuild shopify/dist/theme concurrently).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-theme.mjs')], { stdio: 'pipe' });
}
