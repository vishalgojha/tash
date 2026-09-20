import { query } from '../db/pool.js';
import { getChannel } from '../channels/registry.js';

export interface AuditLine {
  channelId: string;
  sku: string;
  title: string;
  status: string;
  stock: number;
  sellingPrice: number;
  compareAtPrice: number | null;
  cost: number;
  gstPct: number;
  grossMargin: number;
  grossMarginPct: number;
  channelFee: number;
  codFeeEstimate: number;
  fixedFee: number;
  netMargin: number;
  netMarginPct: number;
  [key: string]: unknown;
}

/** Per-listing margin model. Shipping is estimated from ShipRocket separately and layered on gross order level. */
export async function costAudit(opts: {
  channelId?: string;
  sku?: string;
  onlyNegative?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: AuditLine[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (opts.channelId) {
    where.push(`cl.channel_id=$${i++}`);
    params.push(opts.channelId);
  }
  if (opts.sku) {
    where.push(`cl.sku=$${i++}`);
    params.push(opts.sku);
  }
  if (opts.onlyNegative) where.push(`(cl.price - COALESCE(pc.cost,0)) < 0`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const paramsAll = [...params, Number(opts.limit ?? 100), Number(opts.offset ?? 0)];
  const { rows } = await query(
    `SELECT cl.channel_id, cl.sku, cl.title, cl.status, cl.stock, cl.price AS selling_price,
            cl.compare_at_price,
            COALESCE(pc.cost, 0)::numeric AS cost, COALESCE(pc.gst_pct, 0)::numeric AS gst_pct,
            ch.fee_pct, ch.cod_fee_pct, ch.fixed_fee
       FROM channel_listings cl
       JOIN channels ch ON ch.id = cl.channel_id
       LEFT JOIN product_costs pc ON pc.sku = cl.sku
       ${whereSql}
       ORDER BY (cl.price - COALESCE(pc.cost,0)) ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    paramsAll,
  );

  const { rows: totalRows } = await query(
    `SELECT count(*)::int AS n FROM channel_listings cl LEFT JOIN product_costs pc ON pc.sku=cl.sku ${whereSql}`,
    params,
  );

  const out: AuditLine[] = rows.map((r) => {
    const selling = Number(r.selling_price);
    const cost = Number(r.cost);
    const feePct = Number(r.fee_pct) / 100;
    const codFeePct = Number(r.cod_fee_pct) / 100;
    const fixed = Number(r.fixed_fee);
    const gross = selling - cost;
    const channelFee = selling * feePct;
    const codFee = selling * codFeePct;
    const net = gross - channelFee - codFee - fixed;
    return {
      channelId: r.channel_id,
      sku: r.sku,
      title: r.title,
      status: r.status,
      stock: Number(r.stock ?? 0),
      sellingPrice: selling,
      compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
      cost,
      gstPct: Number(r.gst_pct),
      grossMargin: round2(gross),
      grossMarginPct: selling ? round2((gross / selling) * 100) : 0,
      channelFee: round2(channelFee),
      codFeeEstimate: round2(codFee),
      fixedFee: fixed,
      netMargin: round2(net),
      netMarginPct: selling ? round2((net / selling) * 100) : 0,
    };
  });

  return { rows: out, total: totalRows[0]?.n ?? 0 };
}

/** Aggregate margins across channels + ledger-based stock counts for the dashboard. */
export async function costAuditSummary() {
  const { rows } = await query(
    `WITH listed AS (
       SELECT cl.channel_id, cl.sku, cl.price, cl.stock, COALESCE(pc.cost,0) cost, ch.fee_pct, ch.cod_fee_pct, ch.fixed_fee
       FROM channel_listings cl JOIN channels ch ON ch.id=cl.channel_id LEFT JOIN product_costs pc ON pc.sku=cl.sku
     )
     SELECT channel_id,
            count(*)::int AS listings,
            coalesce(sum(stock),0)::int AS units_on_channel,
            coalesce(sum(price),0)::numeric AS gmv,
            coalesce(sum(price - cost),0)::numeric AS gross_margin,
            coalesce(sum(price - cost - price*(fee_pct+cod_fee_pct)/100 - fixed_fee),0)::numeric AS net_margin
       FROM listed GROUP BY channel_id ORDER BY channel_id`,
  );
  return rows.map((r) => {
    const gmv = Number(r.gmv);
    return {
      channelId: r.channel_id,
      listings: r.listings,
      unitsOnChannel: r.units_on_channel,
      gmv: round2(gmv),
      grossMargin: round2(Number(r.gross_margin)),
      grossMarginPct: gmv ? round2((Number(r.gross_margin) / gmv) * 100) : 0,
      netMargin: round2(Number(r.net_margin)),
      netMarginPct: gmv ? round2((Number(r.net_margin) / gmv) * 100) : 0,
    };
  });
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function enterpriseCompare(sku: string) {
  const { rows } = await query(
    `SELECT cl.channel_id, cl.price FROM channel_listings cl WHERE cl.sku=$1 ORDER BY cl.price ASC`,
    [sku],
  );
  const products = await query(
    `SELECT id, title, handle, price_min AS price, images FROM products WHERE id IN (
       SELECT product_id FROM product_variants v JOIN channel_listings cl ON cl.variant_id=v.id WHERE cl.sku=$1
     )`,
    [sku],
  );
  return { sku, channelPricing: rows, product: products.rows[0] ?? null };
}