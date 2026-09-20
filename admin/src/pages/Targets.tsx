import { useEffect, useState } from 'react';
import { api, inr } from '../api';
import { Card, Page } from './Orders';

const fields: { key: string; label: string }[] = [
  { key: 'monthly_profit_target', label: 'Monthly profit target' },
  { key: 'fixed_costs', label: 'Fixed costs / month' },
  { key: 'working_capital_reference', label: 'Working capital reference' },
  { key: 'meta_monthly_spend', label: 'Meta monthly spend' },
  { key: 'contribution_target', label: 'Required contribution' },
  { key: 'contribution_per_order', label: 'Contribution per order' },
  { key: 'target_orders_month', label: 'Target orders / month' },
];

export default function Targets() {
  const [plan, setPlan] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { api('/targets').then((d: any) => setPlan(d.plan)).catch((e) => setErr(e.message)); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      const body: Record<string, number> = {};
      for (const f of fields) body[f.key] = Number((document.getElementById(f.key) as HTMLInputElement).value);
      const r = await api('/targets', { method: 'PUT', body: JSON.stringify(body) });
      setPlan(r.plan);
      setMsg('Targets saved.');
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Page title="Business targets">
      {err && <div className="err">{err}</div>}
      {!plan ? <div className="muted">Loading…</div> : (
        <Card title="Planning assumptions">
          <form onSubmit={save} className="form">
            {fields.map((f) => (
              <label key={f.key} className="label-row">
                <span>{f.label}</span>
                <input id={f.key} className="input" type="number" step="1" defaultValue={Number(plan[f.key] ?? 0)} />
              </label>
            ))}
            {msg && <div className="good">{msg}</div>}
            <button className="btn" type="submit">Save targets</button>
            <div className="muted">These drive the dashboard: contribution per order × orders/month = contribution target = profit + fixed costs.</div>
          </form>
        </Card>
      )}
    </Page>
  );
}