import { config } from './config.js';
import express from 'express';
import { api, errorHandler, files } from './api/routes.js';
import { designsApi } from './api/designs.js';
import { closeBrowser } from './browser/browser.js';
import { prisma } from './db.js';
import { failStaleRuns } from './services/runs.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
  res.json({ ok: db, db, llm: config.llm.enabled, model: config.llm.main, time: new Date().toISOString() });
});
app.use('/api', api);
app.use('/api', designsApi);
app.use('/files', files);
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
