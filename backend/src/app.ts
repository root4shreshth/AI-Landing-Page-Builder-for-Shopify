import { config, REPO_ROOT } from './config.js';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { api, errorHandler, files } from './api/routes.js';
import { designsApi } from './api/designs.js';
import { publishApi } from './api/publish.js';
import { accessGate, hourlyLimit } from './net/access.js';
import { closeBrowser } from './browser/browser.js';
import { prisma } from './db.js';
import { failStaleRuns } from './services/runs.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind one proxy on hosted platforms (Render, etc.): req.ip is the visitor
if (config.access.password) app.use(accessGate(config.access.password));
else if (process.env.RENDER || process.env.NODE_ENV === 'production') console.warn('[backend] APP_PASSWORD is not set: anyone with the URL can start runs and spend LLM credits.');
const spendLimit = hourlyLimit({ perClient: config.access.runsPerClientHour, total: config.access.runsPerHour });
app.post('/api/runs', spendLimit);
app.post('/api/designs/:id/regenerate', spendLimit);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
  res.json({ ok: db, db, llm: config.llm.enabled, model: config.llm.main, time: new Date().toISOString() });
});
app.use('/api', api);
app.use('/api', designsApi);
app.use('/api', publishApi);
app.use('/files', files);
// Production / Docker: serve the built dashboard from the same origin (in development Vite does this on 5180).
const dashboard = path.join(REPO_ROOT, 'frontend', 'dist');
if (existsSync(path.join(dashboard, 'index.html'))) {
  app.use(express.static(dashboard, { index: false, maxAge: '1h' }));
  // client routes only: paths with a file extension (robots.txt, favicon.ico, …) stay 404 rather than returning the app
  app.get(/^\/(?!api\/|files\/)[^.]*$/, (_req, res) => res.sendFile(path.join(dashboard, 'index.html')));
}
app.use(errorHandler);

await failStaleRuns().catch((e) => console.error('[boot] could not check stale runs:', (e as Error).message));

const server = app.listen(config.port, () => {
  console.log(`[backend] listening on http://localhost:${config.port} (LLM ${config.llm.enabled ? config.llm.main : 'disabled'})`);
});

const shutdown = async () => {
  server.close();
  await closeBrowser();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
