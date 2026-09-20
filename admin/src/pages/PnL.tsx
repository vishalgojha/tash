import { useEffect, useState } from 'react';
import { api, inr, num } from '../api';
import { Card, Page } from './Orders';

export default function PnL() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setErr(''); setD(null);
    api(`/analytics/pnl?month=${month}`).then(setD).catch((e) => setErr(e.message));
  }, [month]);

  const recompute = async () => {
    setBusy(true);
    try {
      const r = await api('/analytics/recompute', { method: 'POST', body: JSON.stringify({ days: 90 }) });
      setErr(`Recomputed ${r.updated} orders from source data. Refreshing…`);
      setD(await api(`/analytics/pnl?month=${month}`));
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  const rows = d
    ? [
        ['Revenue (billed)', inr(d.revenue), false],
        ['Net of GST', inr(d.revenue_net_gst), false],
        ['COGS — true cost', `− ${inr(d.cogs)}`, false],
        ['Shipping', `− ${inr(d.deductions.shipping)}`, false],
        ['Payment fees', `− ${inr(d.deductions.payment_fees)}`, false],
        ['Marketplace fees', `− ${inr(d.deductions.marketplace_fees)}`, false],
        ['RTO / returns', `− ${inr(d.deductions.rto)}`, false],
        ['Contribution (pre-ads)', inr(d.contribution_pre_ads), true],
        ['Advertising', `− ${inr(d.ad_cost)}`, false],
        ['Operating overheads', `− ${inr(d.fixed_costs)}`, false],
        ['Operating profit', inr(d.operating_profit), true, d.operating_profit >= 0 ? 'good' : 'bad'],
      ]
    : [];

  return (
    <Page
      title="Profit & Loss"
      right={
        <div className="row-inline">
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn subtle" onClick={recompute} disabled={busy}>{busy ? 'Recomputing…' : 'Recompute order economics'}</button>
        </div>
      }
    >
      {err && <div className="err">{err}</div>}
      {!d ? <div className="muted">Loading…</div> : (
        <div className="grid">
          <Card title={`P&L · ${month}`}>
            {rows.map(([k, v, strong, tone]: any, i) => (
              <div className="row" key={i} style={strong ? { fontWeight: 600 } : {}}>
                <span>{k}</span>
                <b className={tone ? `tone-${tone}` : undefined} style={strong ? undefined : { fontWeight: 400 }}>{v}</b>
              </div>
            ))}
          </Card>
          <Card title="KPI">
            <div className="stat"><b>{num(d.orders)}</b><span>orders</span></div>
            <div className="stat"><b>{inr(d.aov)}</b><span>AOV</span></div>
            <div className="stat"><b>{inr(d.contribution_after_ads)}</b><span>contribution after ads</span></div>
            <div className="stat"><b>{inr(d.contribution_gap)}</b><span>gap to contribution target</span></div>
            <div className="stat"><b>{num(d.orders_needed)}</b><span>orders needed this month</span></div>
          </Card>
        </div>
      )}
    </Page>
  );
}