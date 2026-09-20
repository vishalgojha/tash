import { useEffect, useState } from 'react';
import { api, inr, capitalize } from '../api';
import { Card, Page } from './Orders';

const empty = { sku: '', vendor_cost: 0, embellishment: 0, packaging: 0, gst_pct: 18, lead_time_days: 7, safety_days: 14, target_cover_days: 45, classification: '' };

export default function Products() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any>(empty);
  const [msg, setMsg] = useState('');

  const load = () => {
    setErr(''); setMsg('');
    api('/pricing/skus').then((d: any) => setRows(d.rows)).catch((e) => { setErr(e.message); setRows([]); });
  };
  useEffect(load, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/pricing/sku', { method: 'PUT', body: JSON.stringify(edit) });
      setMsg('Saved.');
      setEdit(empty);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const set = (k: string, v: any) => setEdit((s: any) => ({ ...s, [k]: v }));
  const editRow = (r: any) => setEdit({
    sku: r.sku,
    vendor_cost: r.vendor_cost ?? 0,
    embellishment: r.embellishment ?? 0,
    packaging: r.packaging ?? 0,
    gst_pct: r.gst_pct ?? 0,
    lead_time_days: r.lead_time_days ?? 7,
    safety_days: r.safety_days ?? 14,
    target_cover_days: r.target_cover_days ?? 45,
    classification: r.classification === 'unclassified' ? '' : (r.classification ?? ''),
  });

  return (
    <Page title="Products — per-SKU cost & planning">
      <div className="grid">
        <Card title="Add / update SKU costing">
          <form onSubmit={save} className="form">
            <label>SKU <input className="input" value={edit.sku} onChange={(e) => set('sku', e.target.value)} required /></label>
            <div className="form-row">
              <label>Vendor cost <input className="input" type="number" step="0.01" value={edit.vendor_cost} onChange={(e) => set('vendor_cost', e.target.value)} /></label>
              <label>Embellishment <input className="input" type="number" step="0.01" value={edit.embellishment} onChange={(e) => set('embellishment', e.target.value)} /></label>
              <label>Packaging <input className="input" type="number" step="0.01" value={edit.packaging} onChange={(e) => set('packaging', e.target.value)} /></label>
            </div>
            <div className="form-row">
              <label>GST % <input className="input" type="number" step="0.01" value={edit.gst_pct} onChange={(e) => set('gst_pct', e.target.value)} /></label>
              <label>Lead time (d) <input className="input" type="number" value={edit.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} /></label>
              <label>Safety (d) <input className="input" type="number" value={edit.safety_days} onChange={(e) => set('safety_days', e.target.value)} /></label>
              <label>Target cover (d) <input className="input" type="number" value={edit.target_cover_days} onChange={(e) => set('target_cover_days', e.target.value)} /></label>
            </div>
            <div className="form-row">
              <label>Class override
                <select className="input" value={edit.classification} onChange={(e) => set('classification', e.target.value)}>
                  <option value="">auto</option>
                  {['hero_product', 'fast_seller', 'strong_performer', 'steady_seller', 'slow_mover', 'dead_stock'].map((c) => (
                    <option key={c} value={c}>{capitalize(c)}</option>
                  ))}
                </select>
              </label>
            </div>
            {msg && <div className="good">{msg}</div>}
            {err && <div className="err">{err}</div>}
            <button className="btn" type="submit">Save SKU</button>
          </form>
        </Card>

        <Card title="Cost register" className="span2">
          {!rows ? <div className="muted">Loading…</div> : rows.length === 0 ? <div className="muted">No cost rows yet. Add your first SKU (e.g. Pearl Bloom) to start.</div> : (
            <table>
              <thead>
                <tr>
                  <th>SKU / product</th><th>Vendor</th><th>Embell</th><th>Pack</th><th>True cost</th><th />
                  <th>GST</th><th>Lead</th><th>Safety</th><th>Target cover</th><th>Class</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sku}>
                    <td><b>{r.title || r.sku}</b> <span className="dim">{r.sku}</span></td>
                    <td>{inr(r.vendor_cost)}</td><td>{inr(r.embellishment)}</td><td>{inr(r.packaging)}</td>
                    <td><b>{inr(r.true_cost)}</b></td>
                    <td><button className="btn" type="button" onClick={() => editRow(r)}>Edit</button></td>
                    <td>{r.gst_pct}%</td><td>{r.lead_time_days}d</td><td>{r.safety_days}d</td><td>{r.target_cover_days}d</td>
                    <td><span className="chip">{capitalize(r.classification)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Page>
  );
}
