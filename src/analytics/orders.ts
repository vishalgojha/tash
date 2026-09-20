import { query } from '../db/pool.js';

/**
 * Allocate order-level costs from raw data and upsert into order_costs.
 * The math is the prototype's core: revenue -> net-of-GST -> true cost -> fees/shipping
 * -> contribution (pre-ads), then minus attributed ad spend -> contribution after ads.
 */
export async function computeOrderEconomics(orderId: number | bigint) {
  const { rows } = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!rows.length) return null;
  const o = rows[0];

  const items = (o.line_items ?? []) as any[];
  const fees = {
    gst: 0,
    productCost: 0,
    gross: 0,
    gstBase: 0,
  };

  const skuCostMap = new Map<string, { cost: number; gst: number }>();
  for (const it of items) {
    const sku = it.sku ?? '';
    if (!sku) continue;
    if (!skuCostMap.has(sku)) {
      const { rows: c } = await query(
        `SELECT vendor_cost, embellishment, packaging, cost, gst_pct
           FROM product_costs WHERE sku=$1 OR variant_id=$2 LIMIT 1`,
        [sku, it.variant_id ?? null],
      );
      const r = c[0];
      skuCostMap.set(sku, {
        cost: r ? (Number(r.vendor_cost) + Number(r.embellishment) + Number(r.packaging)) || Number(r.cost) : 0,
        gst: r ? Number(r.gst_pct) : 0,
      });
    }
    const cf = skuCostMap.get(sku)!;
    const qty = Number(it.quantity ?? 0);
    const priceIncl = Number(it.price ?? 0);
    const priceExcl = cf.gst > 0 ? priceIncl / (1 + cf.gst / 100) : priceIncl;
    fees.gross += priceIncl * qty;
    fees.gstBase += priceExcl * qty;
    fees.gst += (priceIncl - priceExcl) * qty;
    fees.productCost += cf.cost * qty;
  }

  // Shipping cost actually charged by ShipRocket (from shipment records).
  const { rows: ship } = await query(
    `SELECT coalesce(sum(cost),0)::numeric AS cost, coalesce(sum(cod_amount),0)::numeric AS cod FROM shipments WHERE order_id=$1`,
    [orderId],
  );
  const shippingCost = Number(ship[0]?.cost ?? 0);
  const codAmount = Number(ship[0]?.cod ?? 0);

  // Payment gateway fee (default ~2% on Razorpay for cards, 0 for COD).
  const gateway = String(o.gateway ?? o.payment_method ?? '').toLowerCase();
  const isCod = (o.financial_status ?? '').toLowerCase().includes('cod') || codAmount > 0;
  const gatewayFeePct = isCod ? 0 : 2.0;
  const paymentFee = Math.round((fees.gstBase * gatewayFeePct) / 100 * 100) / 100;

  // Channel fees (platform commission from channels table).
  const { rows: ch } = await query(`SELECT * FROM channels WHERE id=$1`, [o.channel_id ?? 'shopify']);
  const channel = ch[0];
  const feePct = Number(channel?.fee_pct ?? 0);
  const codFeePct = isCod ? Number(channel?.cod_fee_pct ?? 0) : 0;
  const fixedFee = Number(channel?.fixed_fee ?? 0);
  const marketplaceFee = Math.round((fees.gstBase * feePct) / 100 * 100) / 100 + fixedFee;
  const codFee = Math.round((codAmount * codFeePct) / 100 * 100) / 100;

  const revenue = Number(o.total_price ?? 0);
  const discount = Number(o.total_discounts ?? 0);
  const revenueNetGst = Math.max(0, revenue - fees.gst);

  const contributionPreAds = Math.round(
    (revenueNetGst - fees.productCost - shippingCost - paymentFee - codFee - marketplaceFee - Number(o.rto_penalty ?? 0)) * 100,
  ) / 100;

  await query(
    `INSERT INTO order_costs (
        order_id, channel_id, revenue, revenue_net_gst, discount, gst, product_cost_total,
        shipping_cost, shipping_charged, payment_fee, cod_fee, marketplace_fee,
        rto_penalty, other_deductions, ad_cost, contribution_pre_ads, contribution_after_ads,
        reconciled, recomputed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,$14,$14,$15,now())
      ON CONFLICT (order_id) DO UPDATE SET
        revenue=EXCLUDED.revenue, revenue_net_gst=EXCLUDED.revenue_net_gst,
        discount=EXCLUDED.discount, gst=EXCLUDED.gst, product_cost_total=EXCLUDED.product_cost_total,
        shipping_cost=EXCLUDED.shipping_cost, shipping_charged=EXCLUDED.shipping_charged,
        payment_fee=EXCLUDED.payment_fee, cod_fee=EXCLUDED.cod_fee,
        marketplace_fee=EXCLUDED.marketplace_fee, rto_penalty=EXCLUDED.rto_penalty,
        contribution_pre_ads=EXCLUDED.contribution_pre_ads, contribution_after_ads=EXCLUDED.contribution_after_ads,
        recomputed_at=now()`,
    [
      orderId, o.channel_id ?? 'shopify', revenue, revenueNetGst, discount, Math.round(fees.gst * 100) / 100,
      fees.productCost, shippingCost, Number(o.total_shipping ?? 0), paymentFee, codFee, marketplaceFee,
      Number(o.rto_penalty ?? 0), Number(o.reconciled ?? false),
    ],
  );

  return {
    order_id: orderId,
    channel_id: o.channel_id ?? 'shopify',
    revenue,
    revenue_net_gst: revenueNetGst,
    gst: fees.gst,
    product_cost_total: fees.productCost,
    shipping_cost: shippingCost,
    payment_fee: paymentFee,
    cod_fee: codFee,
    marketplace_fee: marketplaceFee,
    contribution_pre_ads: contributionPreAds,
    contribution_after_ads: contributionPreAds,
    payment_method: o.payment_method ?? o.gateway ?? null,
    items: items.length,
  };
}

export async function recomputeAllOrders(sinceDays = 90): Promise<{ done: number; updated: number }> {
  const { rows } = await query(
    `SELECT id FROM orders WHERE created_at >= now() - ($1::int || ' days')::interval ORDER BY created_at`,
    [sinceDays],
  );
  let updated = 0;
  for (const r of rows) {
    try {
      await computeOrderEconomics(r.id);
      updated++;
    } catch {
      /* keep order_costs uncomputed if it fails; report count anyway */
    }
  }
  return { done: rows.length, updated };
}

/** Monthly P&L from computed order economics + business plan targets. */
export async function pnlForMonth(month: string) {
  const start = `${month}-01`;
  const end = `${month}-01` + '::date + interval \'1 month\'';
  const { rows } = await query(
    `SELECT
        count(*)::int AS orders,
        coalesce(sum(revenue),0)::numeric AS revenue,
        coalesce(sum(discount),0)::numeric AS discounts,
        coalesce(sum(gst),0)::numeric AS gst,
        coalesce(sum(revenue_net_gst),0)::numeric AS revenue_net_gst,
        coalesce(sum(product_cost_total),0)::numeric AS cogs,
        coalesce(sum(shipping_cost),0)::numeric AS shipping,
        coalesce(sum(payment_fee + cod_fee),0)::numeric AS payment_fees,
        coalesce(sum(marketplace_fee),0)::numeric AS marketplace_fees,
        coalesce(sum(rto_penalty + other_deductions),0)::numeric AS rto,
        coalesce(sum(contribution_pre_ads),0)::numeric AS contribution_pre_ads,
        coalesce(sum(ad_cost),0)::numeric AS ad_cost,
        coalesce(sum(contribution_after_ads),0)::numeric AS contribution_after_ads
      FROM order_costs
      WHERE order_id IN (SELECT id FROM orders WHERE created_at >= $1::date AND created_at < ${end})`,
    [start],
  );
  const r = rows[0];
  const plan = await businessPlan();
  const fixedCosts = Number(plan.fixed_costs);
  const profitTarget = Number(plan.monthly_profit_target);
  const contributionTarget = Number(plan.contribution_target);
  const opsProfit = Number(r.contribution_after_ads) - fixedCosts;

  return {
    month,
    orders: Number(r.orders),
    aov: Number(r.orders) ? Math.round(Number(r.revenue) / Number(r.orders)) : 0,
    revenue: Number(r.revenue),
    discounts: Number(r.discounts),
    gst: Number(r.gst),
    revenue_net_gst: Number(r.revenue_net_gst),
    cogs: Number(r.cogs),
    deductions: {
      shipping: Number(r.shipping),
      payment_fees: Number(r.payment_fees),
      marketplace_fees: Number(r.marketplace_fees),
      rto: Number(r.rto),
      total: Number(r.shipping) + Number(r.payment_fees) + Number(r.marketplace_fees) + Number(r.rto),
    },
    contribution_pre_ads: Number(r.contribution_pre_ads),
    ad_cost: Number(r.ad_cost),
    contribution_after_ads: Number(r.contribution_after_ads),
    fixed_costs: fixedCosts,
    operating_profit: opsProfit,
    profit_target: profitTarget,
    contribution_target: contributionTarget,
    contribution_gap: contributionTarget - Number(r.contribution_after_ads),
    profit_gap: profitTarget - opsProfit,
    on_track: opsProfit >= profitTarget,
    orders_needed: Math.max(0, Math.ceil(contributionTarget / Math.max(1, Number(plan.contribution_per_order)))),
  };
}

export async function businessPlan(): Promise<Record<string, number>> {
  const { rows } = await query(`SELECT key, value::numeric, unit FROM business_plan`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = Number(r.value);
  return out;
}

export async function upsertBusinessPlan(entries: Record<string, number>) {
  for (const [k, v] of Object.entries(entries)) {
    await query(
      `INSERT INTO business_plan (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [k, v],
    );
  }
  return businessPlan();
}