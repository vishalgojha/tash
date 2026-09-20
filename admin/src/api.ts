const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    let code: string | undefined;
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') {
        msg = j.error ?? j.message ?? (j.code ? `error ${j.code}` : text);
        code = j.code;
      }
    } catch {}
    const suffix = code && !msg.includes(code) ? ` (${code})` : '';
    throw new Error(`${res.status}: ${msg}${suffix}`);
  }
  return res.json() as Promise<T>;
}

export const inr = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;

export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits });

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number(n)}%`);

export const capitalize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function monthParam(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}