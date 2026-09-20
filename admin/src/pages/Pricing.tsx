import { useState } from 'react';
import { api, inr, pct } from '../api';
import { Card, Page } from './Orders';

const defaults = { vendor_cost: 380, embellishment: 80, packaging: 20, mrp: 1499, discount_pct: 20, gst_pct: 18 };

export default function Pricing() {
  const [f, setF] = useState<any>(defaults);
  const [res, setRes] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  const calc = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const all = await Promise.all(
        ['website', 'amazon', 'myntra', 'nykaa'].map(async (channel) =>
          api('/pricing/calculate', { method: 'POST', body: JSON.stringify({ ...f, channel }) }),
        ),
      );
      setRes(all);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Page title="Pricing calculator — net revenue & contribution per channel">
      <div className="grid">
        <Card title="Inputs">
          <form onSubmit={calc} className="form">
            <div className="form-row">
              <label>Vendor cost <input className="input" type="number" step="0.01" value={f.vendor_cost} onChange={(e) => set('vendor_cost', e.target.value)} /></label>
              <label>Embellishment <input className="input" type="number" step="0.01" value={f.embellishment} onChange={(e) => set('embellishment', e.target.value)} /></label>
              <label>Packaging <input className="input" type="number" step="0.01" value={f.packaging} onChange={(e) => set('packaging', e.target.value)} /></label>
            </div>
            <div className="form-row">
              <label>MRP <input className="input" type="number" step="0.01" value={f.mrp} onChange={(e) => set('mrp', e.target.value)} /></label>
              <label>Discount % <input className="input" type="number" step="0.01" value={f.discount_pct} onChange={(e) => set('discount_pct', e.target.value)} /></label>
              <label>GST % <input className="input" type="number" step="0.01" value={f.gst_pct} onChange={(e) => set('gst_pct', e.target.value)} /></label>
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn" type="submit">Calculate all channels</button>
          </form>
        </Card>

        {res.length > 0 && (
          <Card title="Results" className="span2">
            <table>
              <thead>
                <tr>
                  <th>Channel</th><th>True cost</th><th>Selling price</th><th>Net revenue (ex GST)</th>
                  <th>Fees</th><th>Contribution</th><th>Margin</th><th>Cost %</th><th>Fees %</th>
                </tr>
              </thead>
              <tbody>
                {res.map((r) => (
                  <tr key={r.channel}>
                    <td><b>{r.channel}</b></td>
                    <td>{inr(r.true_cost)}</td>
                    <td>{inr(r.selling_price)}</td>
                    <td>{inr(r.net_revenue_ex_gst)}</td>
                    <td>{inr(r.fees.total)} <span className="dim">({r.fees.commission_pct}% comm + {inr(r.fees.shipping)} ship)</span></td>
                    <td><b>{inr(r.contribution)}</b></td>
                    <td className={r.contribution_margin_pct >= 30 ? 'good' : 'bad'}>{pct(r.contribution_margin_pct)}</td>
                    <td>{pct(r.percents.true_cost_of_net)}</td>
                    <td>{pct(r.percents.fees_of_net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Page>
  );
}