import { useEffect, useState } from 'react';
import { api, inr, num } from '../api';
import { Card, Page } from './Orders';

export default function Marketing() {
  const [d, setD] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setErr(''); setD(null);
    Promise.all([
      api('/analytics/marketing'),
      api('/marketing/ad-inventory'),
    ]).then(([m, r]) => { setD(m); setRisk(r); }).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const pull = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/marketing/meta/pull', { method: 'POST', body: JSON.stringify({ days: 30 }) });
      setErr(`Pulled ${r.written} ad-day rows from Meta.`);
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Page
      title="Marketing — contribution after ads (ROAS ≠ profit)"
      right={d && <button className="btn" onClick={pull} disabled={busy}>{busy ? 'Pulling…' : 'Pull Meta ads'}</button>}
    >
      {err && <div className="err">{err}</div>}
      {!d ? <div className="muted">Loading…</div> : (
        <div className="grid">
          <Card title={`Campaigns · blended contribution rate ${d.total?.contribution_rate ?? '—'}%`}>
            {d.rows.length === 0 && <div className="muted">{d.configured ? 'No ad rows pulled yet.' : 'Meta not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID).'}</div>}
            <table>
              <thead>
                <tr><th>Campaign</th><th>Spend</th><th>Purchases</th><th>Value</th><th>ROAS</th><th>Breakeven</th><th>Est. contribution</th><th>Ver</th></tr>
              </thead>
              <tbody>
                {d.rows.map((m: any) => (
                  <tr key={m.campaign_name}>
                    <td><b>{m.campaign_name}</b></td>
                    <td>{inr(m.spend)}</td>
                    <td>{num(m.purchases)}</td>
                    <td>{inr(m.purchase_value)}</td>
                    <td>{m.roas}</td>
                    <td>{m.breakeven_roas}</td>
                    <td className={m.est_contribution >= 0 ? 'good' : 'bad'}>{inr(m.est_contribution)}</td>
                    <td><span className={`chip ${m.healthy ? 'good' : 'bad'}`}>{m.healthy ? 'profit' : 'loss'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {risk && (
            <Card title="Ad spend vs inventory guardrail" className="span2">
              <div className="muted">{risk.suggestion}</div>
              {risk.at_risk_products?.length > 0 && (
                <table>
                  <thead>
                    <tr><th>Product</th><th>Status</th><th>On hand</th><th>Cover</th><th>Reorder qty</th><th>30d revenue</th></tr>
                  </thead>
                  <tbody>
                    {risk.at_risk_products.map((a: any) => (
                      <tr key={a.sku}>
                        <td><b>{a.title}</b> <span className="dim">{a.sku}</span></td>
                        <td><span className="chip bad">{a.status}</span></td>
                        <td>{num(a.on_hand)}</td>
                        <td>{a.cover_days == null ? '—' : `${a.cover_days}d`}</td>
                        <td>{num(a.reorder_qty)}</td>
                        <td>{inr(a.revenue_30d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}