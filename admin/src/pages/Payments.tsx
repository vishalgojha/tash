import { useEffect, useState } from 'react';
import { api, inr, fmtDate, capitalize } from '../api';
import { Card, Page } from './Orders';

export default function Payments() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/payments/razorpay/ledger?limit=50').then(setD).catch((e) => setErr(e.message));
  }, []);

  const tone = (s: string) => (s === 'paid' ? 'good' : s === 'failed' ? 'bad' : 'warn');

  return (
    <Page title="Payments — Razorpay ledger">
      {err && <div className="err">{err}</div>}
      {!d ? <div className="muted">Loading…</div> : (
        <div className="grid">
          <Card title={`Orders (${d.orders?.length ?? 0})`}>
            {d.orders?.length === 0 && <div className="muted">No Razorpay orders yet — create one via POST /api/v1/payments/razorpay/order.</div>}
            <table>
              <thead>
                <tr><th>Order</th><th>Local</th><th>Amount</th><th>Status</th><th>Captured</th><th>Fee</th><th>Method</th><th>Created</th></tr>
              </thead>
              <tbody>
                {(d.orders ?? []).map((o: any) => (
                  <tr key={o.id}>
                    <td className="mono">{o.id?.slice(0, 16)}…</td>
                    <td>{o.local_order_name ?? '—'}</td>
                    <td>{inr(o.amount)}</td>
                    <td><span className={`chip ${tone(o.status)}`}>{capitalize(o.status)}</span></td>
                    <td>{o.captured_amount ? inr(o.captured_amount) : '—'}</td>
                    <td>{o.fee ? inr(o.fee) : '—'}</td>
                    <td>{o.method ?? '—'}</td>
                    <td>{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title={`Webhook events (${d.events?.length ?? 0})`}>
            {d.events?.length === 0 && <div className="muted">Set up the webhook URL at dashboard.razorpay.com → webhooks: POST {location.origin}/api/v1/payments/razorpay/webhook</div>}
            <table>
              <thead><tr><th>Event</th><th>Entity</th><th>Amount</th><th>Processed</th><th>Created</th></tr></thead>
              <tbody>
                {(d.events ?? []).map((e: any, i: number) => (
                  <tr key={i}>
                    <td><b>{e.event}</b></td>
                    <td>{e.entity}</td>
                    <td>{e.amount ? inr(e.amount) : '—'}</td>
                    <td><span className={`chip ${e.processed ? 'good' : 'warn'}`}>{e.processed ? 'processed' : 'pending'}</span></td>
                    <td>{fmtDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </Page>
  );
}