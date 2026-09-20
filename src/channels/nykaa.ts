import { env, log } from '../config.js';
import { query } from '../db/pool.js';

const BASE = 'https://api.nykaafashion.com/openapi/pub/v1';

export const hasNykaa = () => Boolean(env.nykaaClientId && env.nykaaClientSecret);

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.nykaaClientId,
      client_secret: env.nykaaClientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Nykaa token failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

async function nykaaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`Nykaa ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/** Push quantity to a Nykaa offering (bundleId = SKU at Nykaa). Battles are standard seller API semantics. */
export async function updateInventory(sku: string, quantity: number) {
  if (!hasNykaa()) throw new Error('Nykaa credentials not configured (NYKAA_CLIENT_ID / NYKAA_CLIENT_SECRET)');
  return nykaaApi<any>(`/seller/inventory/${encodeURIComponent(sku)}/quantity`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity: Math.max(0, quantity) }),
  });
}

export async function updatePrice(sku: string, priceInr: number) {
  if (!hasNykaa()) throw new Error('Nykaa credentials not configured');
  return nykaaApi<any>(`/seller/products/${encodeURIComponent(sku)}/price`, {
    method: 'PATCH',
    body: JSON.stringify({ selling_price: priceInr, currency: 'INR' }),
  });
}

export async function syncNykaaInventory() {
  if (!hasNykaa()) return log('nykaa creds not configured — skipping (use POST /channels/nykaa/import)');
  log('nykaa live sync enabled');
}