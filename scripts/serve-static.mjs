// Minimal static server for local previews (no dependencies).
// Usage: node scripts/serve-static.mjs [dir=storage/generated] [port=4310]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(root, process.argv[2] ?? 'storage/generated');
const port = Number(process.argv[3] ?? process.env.PORT ?? 4310);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.resolve(dir, '.' + urlPath);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`[static] ${dir} on http://127.0.0.1:${port}`));
