import { query } from '../db/pool.js';

export interface PricingInput {
  vendor_cost: number;
  embellishment?: number;
  packaging?: number;
  mrp: number;
  discount_pct?: number;
  gst_pct?: number;
  channel?: 'website' | 'amazon' | 'myntra' | 'nykaa' | string;
  shipping_cost?: number;   // what final customer pays for shipping on this channel
}

const CHANNEL_ASSUMPTIONS: Record<string, { commission_pct: number; payment_pct: number; shipping_default: number; cod_pct: number }> = {
  website: { commission_pct: 0, payment_pct: 2, shipping_default: 60, cod_pct: 0 },
  amazon:  { commission_pct: 25, payment_pct: 2, shipping_default: 70, cod_pct: 0 },
  myntra:  { commission_pct: 25, payment_pct: 2, shipping_default: 55, cod_pct: 5 },
  nykaa:   { commission_pct: 25, payment_pct: 2, shipping_default: 55, cod_pct: 5 },
};

export function pricePlan(input: PricingInput) {
  const ch = CHANNEL_ASSUMPTIONS[input.channel ?? 'website'] ?? CHANNEL_ASSUMPTIONS.website;
  const vendor = Number(input.vendor_cost || 0);
  const emb = Number(input.embellishment || 0);
  const pack = Number(input.packaging || 0);
  const trueCost = vendor + emb + pack;
  const gst = Number(input.gst_pct || 0);
  const mrp = Number(input.mrp || 0);
  const discount = Number(input.discount_pct || 0);
  const sellingPrice = mrp * (1 - discount / 100);
  const netRevenue = sellingPrice / (1 + gst / 100);          // net of GST
  const commission = netRevenue * (ch.commission_pct / 100);
  const paymentFee = netRevenue * (ch.payment_pct / 100);
  const codFee = netRevenue * (ch.cod_pct / 100);
  const shipping = Number(input.shipping_cost ?? ch.shipping_default);
  const contribution = netRevenue - trueCost - commission - paymentFee - codFee - shipping;
  const margin = netRevenue > 0 ? contribution / netRevenue : 0;

  return {
    channel: input.channel ?? 'website',
    inputs: {
      vendor_cost: vendor,
      embellishment: emb,
      packaging: pack,
      gst_pct: gst,
      mrp,
      discount_pct: discount,
      shipping_charged: shipping,
    },
    true_cost: Math.round(trueCost * 100) / 100,
    selling_price: Math.round(sellingPrice * 100) / 100,
    net_revenue_ex_gst: Math.round(netRevenue * 100) / 100,
    gst_amount: Math.round((sellingPrice - netRevenue) * 100) / 100,
    fees: {
      commission_pct: ch.commission_pct,
      commission: Math.round(commission * 100) / 100,
      payment_fee: Math.round(paymentFee * 100) / 100,
      cod_fee: Math.round(codFee * 100) / 100,
      shipping: shipping,
      total: Math.round((commission + paymentFee + codFee + shipping) * 100) / 100,
    },
    contribution: Math.round(contribution * 100) / 100,
    contribution_margin_pct: Math.round(margin * 1000) / 10,
    percents: {
      true_cost_of_net: trueCost > 0 ? Math.round((trueCost / netRevenue) * 100) : 0,
      fees_of_net: netRevenue > 0 ? Math.round(((commission + paymentFee + codFee + shipping) / netRevenue) * 100) : 0,
    },
  };
}

/** Upsert full cost + planning record for a SKU (the "products" tab backend). */
export async function upsertSkuCost(input: {
  sku: string;
  product_id?: number | null;
  variant_id?: number | null;
  vendor_cost: number;
  embellishment?: number;
  packaging?: number;
  hsn?: string;
  gst_pct?: number;
  lead_time_days?: number;
  safety_days?: number;
  target_cover_days?: number;
  classification?: string;
}) {
  const trueCost = Number(input.vendor_cost || 0) + Number(input.embellishment || 0) + Number(input.packaging || 0);
  await query(
    `INSERT INTO product_costs (sku, product_id, variant_id, cost, hsn, gst_pct, vendor_cost, embellishment,
                                packaging, lead_time_days, safety_days, target_cover_days, classification, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     ON CONFLICT (sku) DO UPDATE SET
       product_id=COALESCE(EXCLUDED.product_id, product_costs.product_id),
       variant_id=COALESCE(EXCLUDED.variant_id, product_costs.variant_id),
       cost=EXCLUDED.cost, hsn=COALESCE(EXCLUDED.hsn, product_costs.hsn), gst_pct=COALESCE(EXCLUDED.gst_pct, product_costs.gst_pct),
       vendor_cost=EXCLUDED.vendor_cost, embellishment=EXCLUDED.embellishment, packaging=EXCLUDED.packaging,
       lead_time_days=COALESCE(EXCLUDED.lead_time_days, product_costs.lead_time_days),
       safety_days=COALESCE(EXCLUDED.safety_days, product_costs.safety_days),
       target_cover_days=COALESCE(EXCLUDED.target_cover_days, product_costs.target_cover_days),
       classification=COALESCE(EXCLUDED.classification, product_costs.classification), updated_at=now()`,
    [input.sku, input.product_id ?? null, input.variant_id ?? null, trueCost, input.hsn ?? null,
     input.gst_pct ?? 0, input.vendor_cost, input.embellishment ?? 0, input.packaging ?? 0,
     input.lead_time_days ?? 7, input.safety_days ?? 14, input.target_cover_days ?? 45,
     input.classification ?? null],
  );
  await query(
    `INSERT INTO sku_planning (sku, lead_time_days, safety_days, target_cover_days, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (sku) DO UPDATE SET lead_time_days=EXCLUDED.lead_time_days, safety_days=EXCLUDED.safety_days,
       target_cover_days=EXCLUDED.target_cover_days, updated_at=now()`,
    [input.sku, input.lead_time_days ?? 7, input.safety_days ?? 14, input.target_cover_days ?? 45],
  );
  return pricePlan({
    vendor_cost: input.vendor_cost,
    embellishment: input.embellishment,
    packaging: input.packaging,
    mrp: 0, // caller can pass real MRP independently
    gst_pct: input.gst_pct,
  });
}