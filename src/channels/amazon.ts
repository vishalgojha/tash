import { env, log } from '../config.js';
import { query } from '../db/pool.js';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const SP_API_HOST = 'sellingpartnerapi-eu.amazon.com';

let accessToken: { value: string; expiresAt: number } | null = null;

export const hasAmazon = () => Boolean(env.amazonLwaId && env.amazonLwaSecret && env.amazonRefreshToken && env.amazonSellerId);

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.amazonRefreshToken,
      client_id: env.amazonLwaId,
      client_secret: env.amazonLwaSecret,
    }),
  });
  if (!res.ok) throw new Error(`Amazon LWA login failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  accessToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  return data.access_token;
}

async function spApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://${SP_API_HOST}${path}`, {
    ...init,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`Amazon SP-API ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/** Async: sends inventory update to Amazon SP-API. Amazon replies 202; poll operations for completion. */
export async function pushInventory(sku: string, quantity: number) {
  if (!hasAmazon()) throw new Error('Amazon SP-API credentials not configured (AMAZON_LWA_*, AMAZON_SELLER_ID)');
  const body = {
    sellingPartners: [
      { merchantId: env.amazonSellerId, marketplaceIds: [env.amazonMarketplaceId] },
    ],
    inventory: { FBA: '0', FC: '0', MFN: String(Math.max(0, quantity)) },
  };
  return spApi<any>('/feeds/2021-06-30/documents', {
    method: 'POST',
    body: JSON.stringify({
      contentType: 'application/json',
      content: JSON.stringify({ sellerId: env.amazonSellerId, feedDocumentId: body }),
    }),
  });
}

/** List current inventory summary for a SKU from SP-API. */
export async function getInventorySummary(sku: string) {
  if (!hasAmazon()) throw new Error('Amazon SP-API credentials not configured');
  return spApi<any>(`/inventory/v1/summaries?marketplaceIds=${env.amazonMarketplaceId}&details=true&granularityType=Marketplace&granularityId=${env.amazonMarketplaceId}&sellerSkus=${encodeURIComponent(sku)}`);
}

export async function syncAmazonInventory() {
  if (!hasAmazon()) return log('amazon creds not configured — skipping (use POST /channels/amazon/import)');
  log('amazon SP-API live sync enabled — listing inventory/price update flows not wired to UI yet');
}