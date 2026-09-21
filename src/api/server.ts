import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { env, log } from '../config.js';
import { query } from '../db/pool.js';
import { productsRoutes, agentRoutes } from './routes/routes.js';
import { paymentsRoutes } from './routes/payments.js';
import { analyticsRoutes } from './routes/analytics.js';
import { ensureSession } from '../agent/bridge.js';
import { logAgentInfo } from '../agent/agent.js';
import { syncCatalog, syncOrders } from '../shopify/sync.js';

export function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.register(cors, { origin: true });

  // Capture exact raw body so Razorpay webhook signature verification works byte-for-byte.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as any).rawBody = String(body);
      done(null, JSON.parse(String(body) || 'null'));
    } catch (err) {
      done(err as Error);
    }
  });

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
       'POST /api/v1/agent/chat',
       'POST /api/v1/agent/ops',
      'POST /api/v1/channels/:channel/price',
      '--- payments (Razorpay) ---',
      'POST /api/v1/payments/razorpay/order',
      'GET  /api/v1/payments/razorpay/order/:id',
      'POST /api/v1/payments/razorpay/webhook',
      'POST /api/v1/payments/razorpay/refund',
      'GET  /api/v1/payments/razorpay/settlements',
      'GET  /api/v1/payments/razorpay/ledger',
      'GET  /api/v1/payments/razorpay/payment/:id',
      '--- Business OS command centre ---',
      'GET  /api/v1/dashboard',
      'GET  /api/v1/analytics/inventory',
      'GET  /api/v1/analytics/reorder',
      'GET  /api/v1/analytics/pnl',
      'POST /api/v1/analytics/recompute',
      'GET  /api/v1/targets          PUT /api/v1/targets',
      'POST /api/v1/pricing/calculate',
      'PUT  /api/v1/pricing/sku       GET /api/v1/pricing/skus',
      'GET  /api/v1/analytics/cash',
      'GET  /api/v1/analytics/marketing',
      'POST /api/v1/marketing/meta/pull',
      'GET  /api/v1/marketing/ad-inventory',
    ],
  }));

  app.register(async (protectedRoutes) => {
    protectedRoutes.register(productsRoutes, { prefix: '/api/v1' });
    protectedRoutes.register(agentRoutes, { prefix: '/api/v1' });
    protectedRoutes.register(paymentsRoutes, { prefix: '/api/v1' });
    protectedRoutes.register(analyticsRoutes, { prefix: '/api/v1' });
  });

  // Admin dashboard (built Vite SPA in admin-dist/) served on the same origin.
  const adminDist = path.resolve(process.cwd(), 'admin-dist');
  app.register(fastifyStatic, {
    root: adminDist,
    wildcard: false,
    // index.html references hashed bundles; never cache it across deployments.
    maxAge: 0,
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'not found' });
  });

  // Always return a meaningful JSON error body (pg errors and fastify defaults can carry empty messages).
  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    const msg = e.message || (e.code ? `request failed (${e.code})` : 'internal server error');
    return reply.status(status).send({ error: msg, ...(e.code ? { code: e.code } : {}) });
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

export async function boot(dbConnected = true) {
  if (dbConnected && env.syncCron) {
    await cronLoad(env.syncCron);
  }
  await startServer();
  log(`server up on http://${env.host}:${env.port} · db ${dbConnected ? 'connected' : 'DEGRADED'}`);
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
