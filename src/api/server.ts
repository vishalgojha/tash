import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env, log } from '../config.js';
import { query } from '../db/pool.js';
import { productsRoutes, agentRoutes } from './routes/routes.js';
import { ensureSession } from '../agent/bridge.js';
import { logAgentInfo } from '../agent/agent.js';
import { syncCatalog, syncOrders } from '../shopify/sync.js';

export function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.register(cors, { origin: true });

  app.get('/health', async () => {
    const db = await query(`SELECT 1`).then(() => true).catch(() => false);
    return { status: 'ok', db, time: new Date().toISOString(), app: 'app.tashbags.com' };
  });

  app.get('/api/v1', async () => ({
    service: 'Tash Bags unified backend',
    version: '0.1.0',
    endpoints: [
      'GET  /api/v1/products',
      'GET  /api/v1/products/:handle',
      'GET  /api/v1/collections',
      'GET  /api/v1/inventory',
      'GET  /api/v1/inventory/:sku/unified',
      'POST /api/v1/inventory/:sku/push',
      'GET  /api/v1/cost-audit',
      'GET  /api/v1/cost-audit/summary',
      'GET  /api/v1/audit/:sku/compare',
      'GET  /api/v1/channels',
      'GET  /api/v1/sales',
      'POST /api/v1/shiprocket/rates',
      'POST /api/v1/channels/:channel/import',
      'POST /api/v1/sync',
      'POST /api/v1/agent/webhook',
      'GET  /api/v1/agent/test',
    ],
  }));

  app.register(async (protectedRoutes) => {
    protectedRoutes.register(productsRoutes, { prefix: '/api/v1' });
    protectedRoutes.register(agentRoutes, { prefix: '/api/v1' });
  });

  return app;
}

export async function startServer() {
  const app = buildServer();
  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export async function boot() {
  await query(`SELECT 1`).catch((e) => {
    throw new Error(`cannot reach postgres (${e.code ?? e.message}) — start with: docker compose up -d && npm run migrate`);
  });

  if (env.syncCron) {
    await cronLoad(env.syncCron);
  }
  await startServer();
  log(`server up on http://${env.host}:${env.port}`);
  logAgentInfo();
  await ensureSession();
}

async function cronLoad(schedule: string) {
  const cron = await import('node-cron').then((m) => m.default);
  if (cron.validate(schedule)) {
    cron.schedule(schedule, async () => {
      log('running scheduled sync');
      try {
        await syncCatalog();
        await syncOrders();
      } catch (e: any) {
        log('scheduled sync failed:', e.message);
      }
    });
    log(`scheduled sync enabled: ${schedule}`);
  }
}