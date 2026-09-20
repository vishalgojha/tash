import { env, hasAdminAccess } from '../config.js';
import type { ShopifyCollection, ShopifyCustomer, ShopifyOrder, ShopifyProduct } from '../types.js';

const PER_PAGE = 250;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function req(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt <= retries) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 2);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Shopify ${res.status} for ${url}: ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  }
}

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const [url, rel] = part.split(';');
    if (rel?.includes('rel="next"')) return url.trim().slice(1, -1);
  }
  return null;
}

export interface PageResult<T> {
  items: T[];
  nextUrl: string | null;
}

async function getPage<T>(url: string, headers: Record<string, string>): Promise<PageResult<T>> {
  const res = await req(url, headers);
  const data = (await res.json()) as any;
  const key = Object.keys(data)[0];
  const items: T[] = Array.isArray(data[key]) ? data[key] : [];
  const nextUrl: string | null = nextLink(res.headers.get('link'));
  return { items, nextUrl };
}

export async function* paginate<T>(url: string, headers: Record<string, string>): AsyncGenerator<T[]> {
  let cursor: string | null = url;
  while (cursor) {
    const page: PageResult<T> = await getPage<T>(cursor, headers);
    yield page.items;
    cursor = page.nextUrl;
  }
}

export const storefrontHeaders: Record<string, string> = {
  accept: 'application/json',
};

export const adminHeaders: Record<string, string> = hasAdminAccess()
  ? { 'X-Shopify-Access-Token': env.adminToken, accept: 'application/json' }
  : {};

export const storefrontBase = env.storefrontUrl;

export async function* storefrontProducts(): AsyncGenerator<ShopifyProduct[]> {
  yield* paginate<ShopifyProduct>(`${storefrontBase}/products.json?limit=${PER_PAGE}`, storefrontHeaders);
}

export async function* storefrontCollections(): AsyncGenerator<ShopifyCollection[]> {
  yield* paginate<ShopifyCollection>(`${storefrontBase}/collections.json?limit=${PER_PAGE}`, storefrontHeaders);
}

export async function getCollectionProducts(collectionId: number): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for await (const page of paginate<ShopifyProduct>(
    `${storefrontBase}/collections/${collectionId}/products.json?limit=${PER_PAGE}`,
    storefrontHeaders,
  )) {
    all.push(...page);
    await sleep(100);
  }
  return all;
}

const adminBase = () => `https://${env.myshopifyDomain}/admin/api/${env.adminApiVersion}`;

export async function* adminCustomers(): AsyncGenerator<ShopifyCustomer[]> {
  if (!hasAdminAccess()) return;
  yield* paginate<ShopifyCustomer>(`${adminBase()}/customers.json?limit=${PER_PAGE}`, adminHeaders);
}

export async function* adminOrders(): AsyncGenerator<ShopifyOrder[]> {
  if (!hasAdminAccess()) return;
  yield* paginate<ShopifyOrder>(`${adminBase()}/orders.json?status=any&limit=${PER_PAGE}`, adminHeaders);
}