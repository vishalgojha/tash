import { query } from '../db/pool.js';
import { inventoryAnalytics, reorderAlerts } from './inventory.js';
import { pnlForMonth, businessPlan, recomputeAllOrders } from './orders.js';
import { cashSummary } from './cash.js';
import { marketingAnalytics } from './marketing.js';

/** The single command-centre payload: targets vs actuals + what to do next. */
export async function dashboard(month: string) {
  const monthLabel = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);

  const [pnl, plan, cash, inv, alerts, marketing] = await Promise.all([
    pnlForMonth(monthLabel),
    businessPlan(),
    cashSummary(),
    inventoryAnalytics(30),
    reorderAlerts(),
    marketingAnalytics(30).catch(() => ({ rows: [], total: {} })),
  ]);

  const topByContribution = inv.rows
    .slice()
    .sort((a: any, b: any) => b.revenue_30d - a.revenue_30d)
    .slice(0, 8)
    .map((r: any) => ({
      sku: r.sku,
      title: r.product_title,
      classification: r.classification,
      stock_status: r.stock_status,
      units_30d: r.units_30d,
      revenue_30d: r.revenue_30d,
      on_hand: r.on_hand,
      cover_days: r.cover_days,
      contribution_pct: r.contribution_pct,
      margin: r.true_cost > 0 ? Math.round(((r.price - r.true_cost) / r.price) * 100) : null,
    }));

  const productClasses = inv.summary.by_classification;
  const stockStatuses = inv.summary.by_status;

  return {
    as_of: new Date().toISOString(),
    month: monthLabel,
    targets: {
      monthly_profit_target: plan.monthly_profit_target ?? 100000,
      fixed_costs: plan.fixed_costs ?? 100000,
      working_capital_reference: plan.working_capital_reference ?? 150000,
      meta_monthly_spend: plan.meta_monthly_spend ?? 45000,
      contribution_target: plan.contribution_target ?? 200000,
      contribution_per_order: plan.contribution_per_order ?? 1571,
      target_orders_month: plan.target_orders_month ?? 128,
    },
    pnl,
    cash,
    inventory: {
      total_skus: inv.summary.total_skus,
      on_hand_units: inv.summary.on_hand_units,
      inventory_value: Math.round(inv.summary.inventory_value),
      by_classification: productClasses,
      by_stock_status: stockStatuses,
    },
    reorder_alerts: alerts,
    top_skus: topByContribution,
    marketing: {
      ...marketing,
      note: "marketing.est_contribution = purchase_value * blended_contribution_rate - spend (contribution AFTER product cost + fulfilment + fees). ROAS != profit.",
    },
    actions: [
      ...alerts.map((a) => ({
        type: 'reorder',
        priority: a.status === 'stocked_out' ? 'high' : 'medium',
        sku: a.sku,
        message: `${a.title} on hand ${a.on_hand} (${a.status}) — reorder ~${a.suggested_reorder_qty} units`,
      })),
      ...(pnl.contribution_gap > 0
        ? [{ type: 'target', priority: 'high' as const, message: `Contribution short ${pnl.contribution_gap.toLocaleString('en-IN')} vs target — ~${pnl.orders_needed} orders needed this month at plan contribution/order` }]
        : []),
      ...(marketing?.rows?.length
        ? marketing.rows
            .filter((m: any) => !m.healthy)
            .map((m: any) => ({
              type: 'ads',
              priority: 'medium' as const,
              message: `Campaign "${m.campaign_name}" burns ₹${m.spend} for est. contribution ₹${m.est_contribution} (ROAS ${m.roas} vs breakeven ${m.breakeven_roas}) — pause or re-target`,
            }))
        : []),
    ],
  };
}

export { recomputeAllOrders };