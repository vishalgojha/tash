import { useEffect, useState } from 'react';
import { api, inr, num, fmtDate, capitalize } from '../api';
import { Card, Page } from './Orders';

type Status = 'reorder' | 'stocked_out' | 'review' | 'healthy' | 'no_sales';
const statusColor: Record<string, string> = {
  reorder: 'bad', stocked_out: 'bad', review: 'warn', healthy: 'good', no_sales: 'dim',
};

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState<string>('');

  useEffect(() => {
    const m = new Date().toISOString().slice(0, 7);
    setMonth(m);
  }, []);

  useEffect(() => {
    if (!month) return;
    setErr('');
    setD(null);
    api(`/dashboard?month=${month}`).then(setD).catch((e) => setErr(e.message));
  }, [month]);

  if (err) return <Page title="Dashboard"><div className="err">{err}</div></Page>;
  if (!d) return <Page title="Dashboard"><div className="muted">Loading…</div></Page>;

  const pnl = d.pnl ?? {};
  const plan = d.targets ?? {};
  const profitPct = Math.min(100, Math.max(-10, (pnl.operating_profit / Math.max(1, pnl.profit_target)) * 100));
  const contribPct = Math.min(100, Math.max(-10, (pnl.contribution_after_ads / Math.max(1, pnl.contribution_target)) * 100));
  const ordersPct = Math.min(100, Math.max(0, (pnl.orders / Math.max(1, plan.target_orders_month)) * 100));

  return (
    <Page
      title="Command Centre"
      right={
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" style={{ width: 150 }} />
      }
    >
      <div className="grid">
        <Card title="Targets vs Actuals">
          <Metric label="Operating profit" value={inr(pnl.operating_profit)} target={inr(pnl.profit_target)} pct={profitPct} tone={pnl.on_track ? 'good' : 'bad'} />
          <Metric label="Contribution" value={inr(pnl.contribution_after_ads)} target={inr(pnl.contribution_target)} pct={contribPct} tone={pnl.contribution_gap > 0 ? 'bad' : 'good'} />
          <Metric label="Orders" value={num(pnl.orders)} target={`${num(plan.target_orders_month)}/mo`} pct={ordersPct} tone={pnl.orders >= (plan.target_orders_month ?? 0) ? 'good' : 'warn'} />
        </Card>

        <Card title={`P&L · ${month}`}>
          <Row k="Revenue" v={inr(pnl.revenue)} />
          <Row k="COGS (true cost)" v={inr(pnl.cogs)} />
          <Row k="Deductions" v={inr(-(pnl.deductions?.total ?? 0))} />
          <Row k="Contribution (pre-ads)" v={inr(pnl.contribution_pre_ads)} />
          <Row k="Advertising" v={inr(-(pnl.ad_cost ?? 0))} />
          <hr />
          <Row k="Fixed costs" v={inr(-(pnl.fixed_costs ?? 0))} />
          <Row k="Operating profit" v={inr(pnl.operating_profit)} strong tone={pnl.on_track ? 'good' : 'bad'} />
          <div className="muted">Gap to target: {inr(pnl.profit_gap)} · ~{num(pnl.orders_needed)} orders needed</div>
        </Card>

        <Card title="Actions">
          {(d.actions ?? []).length === 0 && <div className="muted">All clear.</div>}
          {(d.actions ?? []).map((a: any, i: number) => (
            <div key={i} className={`action ${a.priority === 'high' ? 'bad' : 'warn'}`}>
              <b>{capitalize(a.type)}:</b> {a.message}
            </div>
          ))}
        </Card>

        <Card title="Inventory Pulse">
          <Row k="SKUs tracked" v={num(d.inventory?.total_skus)} />
          <Row k="Units on hand" v={num(d.inventory?.on_hand_units)} />
          <Row k="Inventory value" v={inr(d.inventory?.inventory_value)} />
          <div className="tags">
            {Object.entries(d.inventory?.by_classification ?? {}).map(([k, v]: any) => (
              <span key={k} className="chip">{capitalize(k)} {v}</span>
            ))}
          </div>
          <div className="muted">Rebuy alerts: {num((d.reorder_alerts ?? []).length)}</div>
        </Card>

        <Card title="Top SKUs" className="span2">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Class</th><th>Stock</th><th>30d units</th><th>30d revenue</th><th>Cover</th><th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {(d.top_skus ?? []).map((s: any) => (
                <tr key={s.sku}>
                  <td><b>{s.title}</b> <span className="dim">{s.sku}</span></td>
                  <td><span className="chip">{capitalize(s.classification)}</span></td>
                  <td>
                    <span className={`chip ${statusColor[s.stock_status] ?? ''}`}>{capitalize(s.stock_status)}</span> {num(s.on_hand)}
                  </td>
                  <td>{num(s.units_30d)}</td>
                  <td>{inr(s.revenue_30d)}</td>
                  <td>{s.cover_days == null ? '—' : `${s.cover_days}d`}</td>
                  <td>{s.margin == null ? '—' : `${s.margin}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Marketing (contribution after ads)">
          {(d.marketing?.rows ?? []).length === 0 && <div className="muted">No ad data yet — connect Meta or POST /marketing/meta/pull.</div>}
          {(d.marketing?.rows ?? []).slice(0, 6).map((m: any) => (
            <div key={m.campaign_name} className="campaign">
              <span><b>{m.campaign_name}</b> <span className="dim">ROAS {m.roas} / breakeven {m.breakeven_roas}</span></span>
              <span className={m.healthy ? 'good' : 'bad'}>{m.healthy ? 'profitable' : 'unprofitable'}</span>
            </div>
          ))}
          <div className="muted">{d.marketing?.note}</div>
        </Card>
      </div>
    </Page>
  );
}

function Metric({ label, value, target, pct, tone }: any) {
  return (
    <div className="metric">
      <div className="metric-top"><span>{label}</span><span className={`tone-${tone}`}>{value}</span></div>
      <div className="bar"><div className={`bar-fill ${tone === 'bad' ? 'bad' : 'good'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
      <div className="metric-tgt">target {target}</div>
    </div>
  );
}
function Row({ k, v, strong, tone }: any) {
  return (
    <div className="row">
      <span>{k}</span>
      <b className={tone ? `tone-${tone}` : ''} style={strong ? undefined : { fontWeight: 400 }}>{v}</b>
    </div>
  );
}