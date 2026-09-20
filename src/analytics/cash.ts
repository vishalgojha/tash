import { query } from '../db/pool.js';
import { businessPlan } from './orders.js';

/**
 * Cash position view. Money in = settled Razorpay captures + COD collected.
 * Money out = Meta ad spend + (could extend to supplier payments).
 */
export async function cashSummary() {
  const plan = await businessPlan();

  const { rows: settled } = await query(
    `SELECT
        coalesce(sum(captured_amount),0)::numeric AS online_settled,
        coalesce(sum(CASE WHEN status='paid' THEN 1 ELSE 0 END),0)::int AS paid_orders
     FROM razorpay_orders`,
  );

  // COD collected from orders marked paid that carried a COD payment method.
  const { rows: cod } = await query(
    `SELECT coalesce(sum(oc.revenue_net_gst),0)::numeric AS cod_received
     FROM order_costs oc JOIN orders o ON o.id=oc.order_id
     WHERE oc.cod_fee > 0 AND o.financial_status IN ('paid','completed','partially_paid')`,
  );

  const { rows: ad } = await query(
    `SELECT coalesce(sum(spend),0)::numeric AS spend FROM meta_ads WHERE date >= date_trunc('month', now())`,
  );

  const workingCapitalReference = Number(plan.working_capital_reference ?? 0);
  const onlineSettled = Number(settled[0]?.online_settled ?? 0);
  const codReceived = Number(cod[0]?.cod_received ?? 0);
  const metaSpendMonth = Number(ad[0]?.spend ?? 0);

  const cashIn = onlineSettled + codReceived;
  const netCash = workingCapitalReference + cashIn - metaSpendMonth;

  return {
    working_capital_reference: workingCapitalReference,
    cash_in: {
      razorpay_settled: onlineSettled,
      cod_received: codReceived,
      total: cashIn,
    },
    cash_out: {
      meta_ads_this_month: metaSpendMonth,
    },
    net_cash_estimate: netCash,
    note: 'net_cash_estimate = working_capital_reference + settled(online+cod) - meta spend. Add supplier payables when tracked.',
  };
}