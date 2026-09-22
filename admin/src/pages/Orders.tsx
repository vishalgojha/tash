import { useEffect, useState } from 'react';
import { api, inr } from '../api';

export default function Orders() {
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/products')
      .then((d: any) => setList(Array.isArray(d) ? d : d.rows ?? []))
      .catch((e) => setErr(e.message));
  }, []);

  // Fallback: list recent orders via the sales endpoint
  return (
    <Page title="Orders">
      {err && !list && <Err>{err}</Err>}
      {!list && !err && <Muted>Loading…</Muted>}
      {list && (
        <Muted>
          Products are synced from Shopify automatically. Order-level contribution is stored per order — run “Recompute
          order economics” on the P&L page after syncing.
        </Muted>
      )}
    </Page>
  );
}

export function Page({ title, children, right, className = '' }: any) {
  return (
    <div className={`page ${className}`}>
      <header className="page-head">
        <h1>{title}</h1>
        {right}
      </header>
      {children}
    </div>
  );
}
export const Card = ({ title, children, className = '' }: any) => (
  <section className={`card ${className}`}>
    {title && <h3 className="card-title">{title}</h3>}
    {children}
  </section>
);
export const Err = ({ children }: any) => <div className="err">{children}</div>;
export const Muted = ({ children }: any) => <div className="muted">{children}</div>;
export const Spinner = () => <div className="muted">Loading…</div>;
export { inr };
