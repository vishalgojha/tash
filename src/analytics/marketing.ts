import { env } from '../config.js';
import { query } from '../db/pool.js';

export const hasMeta = () => Boolean(env.metaAccessToken && env.metaAdAccountId);

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Pull last N days of ad-level daily insights from the Meta Marketing API and store them. */
export async function pullMetaAds(days = 30) {
  if (!hasMeta()) throw new Error('Meta Marketing API not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)');
  const fields = [
    'ad_id', 'ad_name', 'adset_name', 'campaign_name',
    'spend', 'impressions', 'clicks', 'reach',
    'actions', 'purchase_roas', 'cost_per_purchase', 'date_start',
  ].join(',');
  const url = `${GRAPH}/act_${env.metaAdAccountId}/insights?fields=${fields}&level=ad&date_preset=last_${days}d&time_increment=1&access_token=${env.metaAccessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const rows = data.data ?? [];

  let written = 0;
  for (const r of rows) {
    const purchases = (r.actions ?? []).find((a: any) => a.action_type === 'purchase')?.value ?? '0';
    const purchaseValue = (r.purchase_roas ? Number(r.spend) * Number(r.purchase_roas) : 0);
    await query(
      `INSERT INTO meta_ads (date, campaign_name, adset_name, ad_name, spend, impressions, clicks, reach,
                              purchases, purchase_value, purchase_roas, cost_per_purchase, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (date, ad_name) DO UPDATE SET
         campaign_name=EXCLUDED.campaign_name, adset_name=EXCLUDED.adset_name, spend=EXCLUDED.spend,
         impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, reach=EXCLUDED.reach,
         purchases=EXCLUDED.purchases, purchase_value=EXCLUDED.purchase_value,
         purchase_roas=EXCLUDED.purchase_roas, cost_per_purchase=EXCLUDED.cost_per_purchase, data=EXCLUDED.data`,
      [r.date_start, r.campaign_name ?? '', r.adset_name ?? '', r.ad_name ?? '', Number(r.spend ?? 0),
       Number(r.impressions ?? 0), Number(r.clicks ?? 0), Number(r.reach ?? 0),
       Number(purchases), Number(purchaseValue), Number(r.purchase_roas ?? 0),
       Number(r.cost_per_purchase ?? 0), JSON.stringify(r)],
    );
    written++;
  }
  return { pulled: rows.length, written, next_cursor: data.paging?.cursors?.after ?? null };
}

interface MarketingRow {
  campaign_name: string;
  spend: number;
  purchases: number;
  purchase_value: number;
  roas: number;
  contribution_rate: number;   // blended contribution margin from real order economics
  est_contribution: number;    // purchase_value * contribution_rate - spend
  breakeven_roas: number;      // 1 / contribution_rate
  healthy: boolean;
  cpa: number;
}

/** Campaign economics: is each campaign profitable AFTER product+fulfilment+fees? */
export async function marketingAnalytics(days = 30): Promise<{ rows: MarketingRow[]; total: any }> {
  // Blended contribution rate (pre-ads) over the same window, from real order economics.
  const { rows: cr } = await query(
    `SELECT COALESCE(sum(contribution_pre_ads),0)::numeric AS c,
            COALESCE(sum(revenue_net_gst),0)::numeric AS r
     FROM order_costs
     WHERE contribution_pre_ads <> 0
       AND order_id IN (SELECT id FROM orders WHERE created_at >= now() - ($1::int || ' days')::interval)`,
    [days],
  );
  const contributionRate = Number(cr[0]?.r ?? 0) > 0 ? Number(cr[0].c) / Number(cr[0].r) : 0;

  const { rows } = await query(
    `SELECT campaign_name,
            coalesce(sum(spend),0)::numeric AS spend,
            coalesce(sum(purchases),0)::numeric AS purchases,
            coalesce(sum(purchase_value),0)::numeric AS purchase_value
       FROM meta_ads
      WHERE date >= now() - ($1::int || ' days')::interval
      GROUP BY campaign_name
      ORDER BY spend DESC`,
    [days],
  );

  const out: MarketingRow[] = rows.map((r) => {
    const spend = Number(r.spend);
    const purchaseValue = Number(r.purchase_value);
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const estContribution = Math.round((purchaseValue * contributionRate - spend) * 100) / 100;
    const breakeven = contributionRate > 0 ? 1 / contributionRate : 0;
    const purchases = Number(r.purchases);
    return {
      campaign_name: r.campaign_name,
      spend,
      purchases,
      purchase_value: purchaseValue,
      roas: Math.round(roas * 100) / 100,
      contribution_rate: Math.round(contributionRate * 100),
      est_contribution: estContribution,
      breakeven_roas: Math.round(breakeven * 100) / 100,
      healthy: roas >= breakeven && estContribution >= 0,
      cpa: purchases > 0 ? Math.round((spend / purchases) * 100) / 100 : 0,
    };
  });

  return {
    rows: out,
    total: {
      spend: out.reduce((s, r) => s + r.spend, 0),
      purchase_value: out.reduce((s, r) => s + r.purchase_value, 0),
      est_contribution: out.reduce((s, r) => s + r.est_contribution, 0),
      contribution_rate: Math.round(contributionRate * 100),
    },
  };
}