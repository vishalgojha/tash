import { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { inventoryAnalytics, reorderAlerts } from '../../analytics/inventory.js';
import { pnlForMonth, businessPlan, upsertBusinessPlan, recomputeAllOrders, computeOrderEconomics } from '../../analytics/orders.js';
import { cashSummary } from '../../analytics/cash.js';
import { dashboard } from '../../analytics/dashboard.js';
import { marketingAnalytics, pullMetaAds, hasMeta } from '../../analytics/marketing.js';
import { pricePlan, upsertSkuCost } from '../../analytics/pricing.js';

export async function analyticsRoutes(app: FastifyInstance) {
  // ---- Command centre ----
  app.get('/dashboard', async (req, reply) => {
    const q = (req.query ?? {}) as { month?: string };
    try {
      return await dashboard(q.month ?? new Date().toISOString().slice(0, 7));
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'dashboard aggregation failed', code: e.code });
    }
  });

  // ---- Inventory / reorder intelligence ----
  app.get('/analytics/inventory', async (req) => {
    const q = (req.query ?? {}) as { days?: string };
    const { rows, summary } = await inventoryAnalytics(Math.min(90, Math.max(1, Number(q.days ?? 30) || 30)));
    return { rows, summary };
  });

  app.get('/analytics/reorder', async (req) => {
    const q = (req.query ?? {}) as { min?: string };
    return { alerts: await reorderAlerts(Number(q.min ?? 1) || 1) };
  });

  // ---- P&L ----
  app.get('/analytics/pnl', async (req) => {
    const q = (req.query ?? {}) as { month?: string };
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    return await pnlForMonth(month);
  });

  // Recompute order economics for recent orders (or one order)
  app.post('/analytics/recompute', async (req, reply) => {
    const b = (req.body ?? {}) as { days?: number; order_id?: number };
    if (b.order_id) {
      const r = await computeOrderEconomics(b.order_id);
      return r ?? reply.code(404).send({ error: 'order not found' });
    }
    return await recomputeAllOrders(b.days ?? 90);
  });

  // ---- Targets / plan ----
  app.get('/targets', async () => ({ plan: await businessPlan() }));
  app.put('/targets', async (req) => {
    const b = (req.body ?? {}) as Record<string, number>;
    return { plan: await upsertBusinessPlan(b) };
  });

  // ---- Pricing calculator + SKU cost CRUD ----
  app.post('/pricing/calculate', async (req, reply) => {
    const b = req.body as Record<string, any>;
    if (b.vendor_cost === undefined || b.mrp === undefined) {
      return reply.code(400).send({ error: 'vendor_cost and mrp are required' });
    }
    return pricePlan({
      vendor_cost: Number(b.vendor_cost),
      embellishment: Number(b.embellishment ?? 0),
      packaging: Number(b.packaging ?? 0),
      mrp: Number(b.mrp),
      discount_pct: Number(b.discount_pct ?? 0),
      gst_pct: Number(b.gst_pct ?? 0),
      channel: String(b.channel ?? 'website'),
      shipping_cost: b.shipping_cost !== undefined ? Number(b.shipping_cost) : undefined,
    });
  });

  app.put('/pricing/sku', async (req, reply) => {
    const b = req.body as Record<string, any>;
    if (!b.sku) return reply.code(400).send({ error: 'sku required' });
    if (b.vendor_cost === undefined && b.lead_time_days === undefined) {
      return reply.code(400).send({ error: 'vendor_cost or planning fields required' });
    }
    return await upsertSkuCost({
      sku: String(b.sku),
      product_id: b.product_id ? Number(b.product_id) : null,
      variant_id: b.variant_id ? Number(b.variant_id) : null,
      vendor_cost: Number(b.vendor_cost ?? 0),
      embellishment: b.embellishment !== undefined ? Number(b.embellishment) : undefined,
      packaging: b.packaging !== undefined ? Number(b.packaging) : undefined,
      hsn: b.hsn,
      gst_pct: b.gst_pct !== undefined ? Number(b.gst_pct) : undefined,
      lead_time_days: b.lead_time_days !== undefined ? Number(b.lead_time_days) : undefined,
      safety_days: b.safety_days !== undefined ? Number(b.safety_days) : undefined,
      target_cover_days: b.target_cover_days !== undefined ? Number(b.target_cover_days) : undefined,
      classification: b.classification,
    });
  });

  app.get('/pricing/skus', async () => {
    const { rows } = await query(
      `SELECT pc.sku, pc.vendor_cost, pc.embellishment, pc.packaging, pc.cost, pc.gst_pct, pc.hsn,
              pc.lead_time_days, pc.safety_days, pc.target_cover_days, pc.classification,
              p.title, p.price_min
         FROM product_costs pc
         LEFT JOIN products p ON p.id = pc.product_id
        ORDER BY p.title NULLS LAST, pc.sku`,
    );
    return { rows: rows.map((r) => ({ ...r, true_cost: Number(r.vendor_cost) + Number(r.embellishment) + Number(r.packaging) })) };
  });

  // ---- Cash ----
  app.get('/analytics/cash', async () => cashSummary());

  // ---- Marketing / Meta Ads ----
  app.get('/analytics/marketing', async (req) => {
    const q = (req.query ?? {}) as { days?: string };
    const r = await marketingAnalytics(Math.min(90, Math.max(1, Number(q.days ?? 30) || 30)));
    return { configured: hasMeta(), ...r };
  });

  app.post('/marketing/meta/pull', async (req, reply) => {
    const b = (req.body ?? {}) as { days?: number };
    try {
      return await pullMetaAds(b.days ?? 30);
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // ---- Ad spend vs inventory guardrail (don't scale a product about to stock out) ----
  app.get('/marketing/ad-inventory', async (req) => {
    const q = (req.query ?? {}) as { days?: string };
    const days = Math.min(90, Math.max(1, Number(q.days ?? 30) || 30));
    const [mk, inv] = await Promise.all([marketingAnalytics(days), inventoryAnalytics(days)]);
    const atRisk = inv.rows
      .filter((r) => r.stock_status !== 'healthy')
      .sort((a, b) => b.revenue_30d - a.revenue_30d)
      .map((r) => ({
        sku: r.sku,
        title: r.product_title,
        status: r.stock_status,
        on_hand: r.on_hand,
        cover_days: r.cover_days,
        reorder_qty: r.reorder_qty,
        revenue_30d: r.revenue_30d,
      }));

    const spendOnAtRisk = mk.rows.filter((m) =>
      atRisk.some((a) => `${a.sku} ${a.title}`.toLowerCase().split(' ').some((w) => w.length > 3 && m.campaign_name.toLowerCase().includes(w)),
    ));
    return {
      note: 'Campaigns whose target product is at/under reorder point — spend is riskier here.',
      at_risk_products: atRisk,
      campaigns_matching_at_risk: spendOnAtRisk,
      suggestion: atRisk.length ? 'Priority: reserve stock for at-risk top sellers; consider all-time high ad spend elsewhere.' : 'Stock levels healthy — ads can scale.',
    };
  });
}