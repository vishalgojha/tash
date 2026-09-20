import { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { syncAll, syncCatalog, syncOrders } from '../../shopify/sync.js';
import { costAudit, costAuditSummary, enterpriseCompare } from '../../cost/audit.js';
import { listChannels, importListings, type ListingInput } from '../../channels/registry.js';
import { getShippingRates } from '../../shiprocket/client.js';
import { parseWebhook, notifyLaptop } from '../../agent/bridge.js';
import { handleIncoming } from '../../agent/agent.js';

export async function productsRoutes(app: FastifyInstance) {
  app.get('/products', async (req) => {
    const q = req.query as {
      q?: string; collection?: string; tag?: string; available?: string; status?: string;
      sort?: string; limit?: string; offset?: string; handle?: string; sku?: string;
    };
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (q.q) {
      where.push(`(
        to_tsvector('simple', p.title || ' ' || p.handle || ' ' || p.vendor || ' ' || p.tags::text)
        @@ plainto_tsquery('simple', $${i++})
      )`);
      params.push(q.q.split(/\s+/).join(' | '));
    }
    if (q.handle) {
      where.push(`p.handle = $${i++}`);
      params.push(q.handle);
    }
    if (q.sku) {
      where.push(`EXISTS (SELECT 1 FROM channel_listings cl2 WHERE cl2.sku = $${i} AND cl2.product_id = p.id)`);
      params.push(q.sku);
    }
    if (q.tag) {
      where.push(`$${i} = ANY(p.tags)`);
      params.push(q.tag);
    }
    if (q.available === 'true') where.push(`p.available = true`);
    if (q.status) {
      where.push(`p.status = $${i++}`);
      params.push(q.status);
    }
    if (q.collection) {
      where.push(`EXISTS (SELECT 1 FROM collection_products cp JOIN collections c ON c.id=cp.collection_id WHERE c.id=CAST($${i} AS bigint) AND cp.product_id=p.id)`);
      params.push(q.collection);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = q.sort ?? 'updated_at';
    const sortSafe = ['updated_at', 'title', 'price_min', 'price_max', 'created_at'].includes(sort) ? sort : 'updated_at';
    const dir = q.sort?.startsWith('-') ? 'DESC' : 'ASC';
    const sortCol = q.sort?.startsWith('-') ? sort.slice(1) : sort;
    const limit = Math.min(Number(q.limit ?? 50) || 50, 250);
    const offset = Number(q.offset ?? 0) || 0;
    const paramsAll = [...params, limit, offset];

    const { rows } = await query(
      `SELECT p.id, p.handle, p.title, p.vendor, p.product_type, p.tags, p.status, p.options, p.images,
              p.price_min, p.price_max, p.available, p.published_at, p.updated_at,
              (SELECT json_agg(cl2 ORDER BY cl2.channel_id) FILTER (WHERE cl2.channel_id <> 'shopify')
                 FROM channel_listings cl2 WHERE cl2.product_id=p.id) AS other_listings
         FROM products p ${whereSql}
         ORDER BY p.${sortSafe} ${dir}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      paramsAll,
    );
    const { rows: countRows } = await query(`SELECT count(*)::int AS n FROM products p ${whereSql}`, params);
    return { total: countRows[0]?.n ?? 0, limit, offset, items: rows };
  });

  app.get('/products/:handle', async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const { rows } = await query(
      `SELECT p.*, (SELECT json_agg(v) FROM product_variants v WHERE v.product_id=p.id) AS variants,
              (SELECT json_agg(c) FROM collections c JOIN collection_products cp ON cp.collection_id=c.id WHERE cp.product_id=p.id) AS collections
         FROM products p WHERE p.handle=$1`,
      [handle],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not found' });
    return rows[0];
  });

  app.get('/collections', async () => {
    const { rows } = await query(
      `SELECT c.*, count(cp.product_id)::int AS product_count
         FROM collections c LEFT JOIN collection_products cp ON cp.collection_id=c.id
        GROUP BY c.id ORDER BY c.title`,
    );
    return { items: rows };
  });

  app.get('/inventory', async (req) => {
    const q = req.query as { sku?: string; title?: string; channel?: string; low?: string; limit?: string; offset?: string };
    const where: string[] = [];
    const p: unknown[] = [];
    let i = 1;
    if (q.sku) {
      where.push(`cl.sku ILIKE $${i++}`);
      p.push(`%${q.sku}%`);
    }
    if (q.title) {
      where.push(`cl.title ILIKE $${i++}`);
      p.push(`%${q.title}%`);
    }
    if (q.channel) {
      where.push(`cl.channel_id = $${i++}`);
      p.push(q.channel);
    }
    if (q.low === 'true') {
      where.push(`cl.stock IS DISTINCT FROM NULL AND cl.stock < 5`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT cl.sku, cl.title AS listing_title, cl.channel_id, cl.price, cl.stock, cl.status, cl.weight_g,
              cl.external_id, cl.last_synced_at, p.handle, p.title AS product_title
         FROM channel_listings cl LEFT JOIN products p ON p.id=cl.product_id
         ${whereSql}
        ORDER BY CASE WHEN cl.stock IS NULL THEN 1 ELSE 0 END, cl.stock ASC
        LIMIT $${i+1} OFFSET $${i+2}`,
      [...p, Math.min(Number(q.limit ?? 100) || 100, 500), Number(q.offset ?? 0) || 0],
    );
    return { items: rows };
  });

  app.get('/inventory/:sku/unified', async (req, reply) => {
    const { sku } = req.params as { sku: string };
    const { rows } = await query(
      `SELECT cl.channel_id, cl.title, cl.price, cl.stock, cl.status, cl.last_synced_at
         FROM channel_listings cl WHERE cl.sku=$1 ORDER BY cl.channel_id`,
      [sku],
    );
    if (!rows.length) return reply.code(404).send({ error: `no listing for sku ${sku}` });
    const total = rows.reduce((s, r) => s + (r.stock ?? 0), 0);
    return { sku, channels: rows, totalAvailable: total };
  });

  app.post('/inventory/:sku/push', async (req, reply) => {
    const { sku } = req.params as { sku: string };
    const body = req.body as { stock?: number; channel?: string };
    if (!Number.isInteger(body.stock)) return reply.code(400).send({ error: 'stock must be an integer' });
    const channels = body.channel ? [body.channel] : ['myntra'];
    const updated: string[] = [];
    for (const channel of channels) {
      const r = await query(
        `UPDATE channel_listings SET stock=$1, last_synced_at=now() WHERE channel_id=$2 AND sku=$3 RETURNING channel_id`,
        [body.stock, channel, sku],
      );
      if (r.rows.length) updated.push(channel);
    }
    await query(
      `INSERT INTO inventory_ledger (sku, channel_id, delta, reason, note) VALUES ($1, NULL, $2, 'adjustment', 'manual push from API')`,
      [sku, body.stock],
    );
    return { sku, pushedTo: updated.length ? updated : ['none'], requested: channels };
  });

  app.get('/cost-audit', async (req) => {
    const q = req.query as { channel?: string; sku?: string; negative?: string; limit?: string; offset?: string };
    return costAudit({
      channelId: q.channel,
      sku: q.sku,
      onlyNegative: q.negative === 'true',
      limit: Number(q.limit ?? 100),
      offset: Number(q.offset ?? 0),
    });
  });

  app.get('/cost-audit/summary', async () => costAuditSummary());

  app.get('/audit/:sku/compare', async (req) => {
    return enterpriseCompare((req.params as { sku: string }).sku);
  });

  app.get('/channels', async () => ({ items: await listChannels() }));

  app.get('/sales', async (req) => {
    const q = req.query as { from?: string; to?: string; channel?: string };
    const where: string[] = [];
    const p: unknown[] = [];
    let i = 1;
    if (q.from) {
      where.push(`o.created_at >= $${i++}`);
      p.push(new Date(q.from).toISOString());
    }
    if (q.to) {
      where.push(`o.created_at <= $${i++}`);
      p.push(new Date(q.to).toISOString());
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT count(*)::int AS orders,
              coalesce(sum(o.total_price),0)::numeric AS revenue,
              coalesce(sum(o.total_discounts),0)::numeric AS discounts,
              coalesce(sum(o.total_shipping),0)::numeric AS shipping,
              coalesce(avg(o.total_price),0)::numeric AS aov,
              count(*) FILTER (WHERE o.financial_status ILIKE 'paid')::int AS paid
         FROM orders o ${whereSql}`,
      p,
    );
    return { metrics: rows[0] };
  });

  app.post('/shiprocket/rates', async (req, reply) => {
    const body = req.body as { zipcode: string; weight_g?: number; cod?: boolean; amount?: number };
    if (!body.zipcode) return reply.code(400).send({ error: 'zipcode required' });
    try {
      return { rates: await getShippingRates(body.zipcode, body.weight_g ?? 500, Boolean(body.cod), body.amount ?? 0) };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });

  app.post('/channels/:channel/import', async (req, reply) => {
    const { channel } = req.params as { channel: string };
    const body = req.body as { listings?: ListingInput[] };
    if (!Array.isArray(body.listings) || !body.listings.length) return reply.code(400).send({ error: 'listings[] required' });
    const result = await importListings(channel, body.listings);
    return result;
  });

  app.post('/sync', async (req, reply) => {
    const body = (req.body ?? {}) as { orders_only?: boolean; sync?: boolean };
    try {
      if (body.orders_only) await syncOrders();
      else await syncAll({ sync: body.sync });
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });
}

export async function agentRoutes(app: FastifyInstance) {
  app.post('/agent/webhook', async (req, reply) => {
    const msg = parseWebhook(req.body);
    if (!msg || msg.fromMe || !msg.text) return reply.code(200).send({ ok: true, skipped: true });
    const replyText = await handleIncoming(msg);
    return { ok: true, replied: true, to: msg.chatId };
  });

  app.get('/agent/test', async (req, reply) => {
    const q = req.query as { text?: string };
    if (!q.text) return reply.code(400).send({ error: '?text= required' });
    const message = await handleIncoming({ id: `test-${Date.now()}`, chatId: 'cli-test', phone: '911234567890', text: q.text });
    return { message };
  });
}