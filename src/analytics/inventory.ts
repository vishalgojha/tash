import { query } from '../db/pool.js';

export interface SkuRow {
  sku: string;
  product_id: number | null;
  product_title: string;
  channel: string;
  price: number;
  on_hand: number;
  vendor_cost: number;
  embellishment: number;
  packaging: number;
  true_cost: number;
  gst_pct: number;
  lead_days: number;
  safety_days: number;
  target_cover: number;
  units_30d: number;
  units_60d: number;
  units_90d: number;
  revenue_30d: number;
  velocity: number;         // units/day (30d)
  safety_stock: number;
  reorder_point: number;
  cover_days: number | null;
  reorder_qty: number;
  classification: string;
  stock_status: string;
  contribution_pct: number;
}

async function salesBySku(days: number): Promise<Map<string, { units: number; revenue: number }>> {
  const { rows } = await query(
    `SELECT li->>'sku' AS sku,
            coalesce(sum((li->>'quantity')::int),0)::int AS units,
            coalesce(sum(((li->>'price')::numeric) * (li->>'quantity')::int),0)::numeric AS revenue
     FROM orders, jsonb_array_elements(line_items) li
     WHERE created_at >= now() - ($1::int || ' days')::interval
       AND financial_status IN ('paid','partially_paid','pending','completed', 'refunded')
     GROUP BY 1`,
    [days],
  );
  const m = new Map<string, { units: number; revenue: number }>();
  for (const r of rows) m.set(r.sku, { units: Number(r.units), revenue: Number(r.revenue) });
  return m;
}

async function planningOverrides(): Promise<Record<string, { lead_time_days?: number; safety_days?: number; target_cover_days?: number; reorder_qty_min?: number }>> {
  const { rows } = await query(`SELECT sku, lead_time_days, safety_days, target_cover_days, reorder_qty_min FROM sku_planning`);
  const m: Record<string, any> = {};
  for (const r of rows) m[r.sku] = r;
  return m;
}

export function classify(units30d: number, contributionPct: number): string {
  if (units30d >= 60) return 'hero_product';
  if (units30d >= 30) return 'fast_seller';
  if (units30d >= 15) return 'strong_performer';
  if (units30d >= 5) return 'steady_seller';
  if (units30d >= 1) return 'slow_mover';
  return 'dead_stock';
}

function reorderDecision(args: {
  velocity: number;
  onHand: number;
  reorderPoint: number;
  targetCover: number;
}): string {
  if (args.onHand <= 0) return 'stocked_out';
  if (args.velocity <= 0) return 'no_sales';
  if (args.onHand <= args.reorderPoint) return 'reorder';
  const cover = args.onHand / args.velocity;
  if (cover < args.targetCover) return 'review';
  return 'healthy';
}

/** Inventory + classification + reorder intelligence per SKU (warehouse stock = Shopify listing). */
export async function inventoryAnalytics(days = 30) {
  const s30 = await salesBySku(30);
  const s60 = await salesBySku(60);
  const s90 = await salesBySku(90);
  const overrides = await planningOverrides();

  const { rows } = await query(
    `SELECT v.sku,
            p.id AS product_id,
            p.title AS product_title,
            v.price,
            COALESCE((SELECT stock FROM channel_listings cl WHERE cl.channel_id='shopify' AND cl.sku=v.sku ORDER BY last_synced_at DESC LIMIT 1), 0)::int AS on_hand,
            coalesce(pc.vendor_cost,0)::numeric AS vendor_cost,
            coalesce(pc.embellishment,0)::numeric AS embellishment,
            coalesce(pc.packaging,0)::numeric AS packaging,
            coalesce(pc.cost,0)::numeric AS cost,
            coalesce(pc.gst_pct,0)::numeric AS gst_pct,
            coalesce(sp.lead_time_days, pc.lead_time_days, 7)::int AS lead_days,
            coalesce(sp.safety_days, pc.safety_days, 14)::int AS safety_days,
            coalesce(sp.target_cover_days, pc.target_cover_days, 45)::int AS target_cover,
            coalesce(sp.reorder_qty_min, 0)::int AS reorder_qty_min,
            pc.classification
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN product_costs pc ON pc.sku = v.sku OR pc.variant_id = v.id
     LEFT JOIN sku_planning sp ON sp.sku = v.sku
     WHERE v.sku IS NOT NULL AND v.sku <> ''`,
  );

  const out: SkuRow[] = [];
  for (const r of rows) {
    const sku = r.sku;
    const ov = overrides[sku] ?? {};
    const leadDays = Number(ov.lead_time_days ?? r.lead_days);
    const safetyDays = Number(ov.safety_days ?? r.safety_days);
    const targetCover = Number(ov.target_cover_days ?? r.target_cover);
    const onHand = Number(r.on_hand);

    const sell30 = s30.get(sku) ?? { units: 0, revenue: 0 };
    const sell60 = s60.get(sku) ?? { units: 0, revenue: 0 };
    const sell90 = s90.get(sku) ?? { units: 0, revenue: 0 };

    const velocity = sell30.units / 30;
    const safetyStock = Math.round(velocity * safetyDays);
    const reorderPoint = Math.round(velocity * leadDays + safetyStock);
    const coverDays = velocity > 0 ? onHand / velocity : null;
    const trueCost = Number(r.vendor_cost) + Number(r.embellishment) + Number(r.packaging) || Number(r.cost);
    const price = Number(r.price);
    const margin = price > 0 ? (price - trueCost) / price : 0;
    const contributionPct = Math.round(margin * 100);

    const reorderQty = velocity > 0
      ? Math.max(Number(ov.reorder_qty_min ?? r.reorder_qty_min), Math.ceil((leadDays + safetyDays + targetCover) * velocity - onHand))
      : Number(ov.reorder_qty_min ?? r.reorder_qty_min);

    const classification = r.classification && r.classification !== 'unclassified'
      ? r.classification
      : classify(sell30.units, contributionPct);

    out.push({
      sku,
      product_id: r.product_id,
      product_title: r.product_title,
      channel: 'shopify',
      price,
      on_hand: onHand,
      vendor_cost: Number(r.vendor_cost),
      embellishment: Number(r.embellishment),
      packaging: Number(r.packaging),
      true_cost: trueCost,
      gst_pct: Number(r.gst_pct),
      lead_days: leadDays,
      safety_days: safetyDays,
      target_cover: targetCover,
      units_30d: sell30.units,
      units_60d: sell60.units,
      units_90d: sell90.units,
      revenue_30d: Math.round(sell30.revenue),
      velocity: Number(velocity.toFixed(3)),
      safety_stock: safetyStock,
      reorder_point: reorderPoint,
      cover_days: coverDays === null ? null : Number(coverDays.toFixed(1)),
      reorder_qty: reorderQty,
      classification,
      stock_status: reorderDecision({ velocity, onHand, reorderPoint, targetCover }),
      contribution_pct: contributionPct,
    });
  }

  const summary = {
    total_skus: out.length,
    on_hand_units: out.reduce((s, o) => s + o.on_hand, 0),
    inventory_value: out.reduce((s, o) => s + o.on_hand * o.true_cost, 0),
    by_classification: out.reduce((acc, o) => { acc[o.classification] = (acc[o.classification] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    by_status: out.reduce((acc, o) => { acc[o.stock_status] = (acc[o.stock_status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
  };

  return { rows: out, summary };
}

/** Orders needing a purchase decision right now. */
export async function reorderAlerts(minReorderQty = 1) {
  const { rows } = await inventoryAnalytics(30);
  return rows
    .filter((r) => (r.stock_status === 'reorder' || r.stock_status === 'stocked_out') && r.reorder_qty >= minReorderQty)
    .sort((a, b) => a.cover_days ?? -1 - (b.cover_days ?? -1))
    .map((r) => ({
      sku: r.sku,
      title: r.product_title,
      status: r.stock_status,
      on_hand: r.on_hand,
      reorder_point: r.reorder_point,
      velocity: r.velocity,
      cover_days: r.cover_days,
      suggested_reorder_qty: r.reorder_qty,
      classification: r.classification,
    }));
}