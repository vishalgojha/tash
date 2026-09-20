import { useEffect, useState } from 'react';
import { api, inr, num, capitalize } from '../api';
import { Card, Page } from './Orders';

export default function Inventory() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(30);

  useEffect(() => {
    setRows(null); setErr('');
    api(`/analytics/inventory?days=${days}`)
      .then((d: any) => setRows(d.rows))
      .catch((e) => { setErr(e.message); setRows([]); });
  }, [days]);

  const statusTone: Record<string, string> = { reorder: 'bad', stocked_out: 'bad', review: 'warn', healthy: 'good', no_sales: 'dim' };

  return (
    <Page
      title="Inventory intelligence"
      right={
        <div className="seg">
          {[30, 60, 90].map((d) => (
            <button key={d} className={`seg-btn${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      }
    >
      {err && <div className="err">{err}</div>}
      {!rows ? <div className="muted">Loading…</div> : rows.length === 0 ? (
        <div className="muted">No catalogue synced yet. Run POST /api/v1/sync after connecting Shopify + a database.</div>
      ) : (
        <Card className="span2">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Class</th><th>Status</th><th>On hand</th>
                <th>Velocity/d</th><th>Cover</th><th>Reorder pt</th><th>Reorder qty</th><th>30d units</th><th>30d rev</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td><b>{r.product_title || r.sku}</b> <span className="dim">{r.sku}</span></td>
                  <td><span className="chip">{capitalize(r.classification)}</span></td>
                  <td><span className={`chip ${statusTone[r.stock_status]}`}>{capitalize(r.stock_status)}</span></td>
                  <td><b>{num(r.on_hand)}</b></td>
                  <td>{r.velocity}</td>
                  <td>{r.cover_days == null ? '—' : `${r.cover_days}d`}</td>
                  <td>{num(r.reorder_point)}</td>
                  <td>{r.reorder_qty ? <b className="good">{num(r.reorder_qty)}</b> : '—'}</td>
                  <td>{num(r.units_30d)}</td>
                  <td>{inr(r.revenue_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}