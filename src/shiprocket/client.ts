import { hasShiprocket, log } from '../config.js';
import { query } from '../db/pool.js';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

let token: { value: string; expiresAt: number } | null = null;

async function shiprocketAuth(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  if (!hasShiprocket()) throw new Error('ShipRocket credentials not configured');
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
  });
  if (!res.ok) throw new Error(`ShipRocket login failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  token = { value: data.token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.token;
}

async function shipApi<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await shiprocketAuth();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`ShipRocket ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export interface ShipRate {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  estimated_delivery_days: number;
  rto_charges?: number;
  etd?: string;
}

export async function getShippingRates(zipcode: string, weightGrams: number, cod: boolean, amount: number): Promise<ShipRate[]> {
  const body = {
    pickup_postcode: '110001',
    delivery_postcode: zipcode,
    cod,
    weight: Math.max(1, Math.round((weightGrams || 500) / 1000) * 1000 / 1000),
    dimension: { length: 20, breadth: 15, height: 5 },
  };
  const data: any = await shipApi('/courier/serviceability/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return (data.available_courier_companies ?? []).map((c: any) => ({
    courier_company_id: c.courier_company_id,
    courier_name: c.courier_name,
    rate: Number(c.rate ?? c.freight_charge ?? 0),
    estimated_delivery_days: Number(c.estimated_delivery_days ?? 0),
  }));
}

export async function createShipment(args: {
  orderId: bigint;
  orderName: string;
  customer: { name: string; phone: string; address1: string; city: string; state: string; zipcode: string; country: string };
  items: { name: string; sku: string; units: number; selling_price: number }[];
  weightGrams: number;
  codAmount: number;
  courierId: number;
}) {
  const data: any = await shipApi('/shipments/create/forward', {
    method: 'POST',
    body: JSON.stringify({
      order_id: String(args.orderId),
      order_date: new Date().toISOString().split('T')[0],
      pickup_location: 'home',
      channel_id: '',
      comment: '',
      reseller_name: '',
      company_name: 'Tash Bags',
      billing_customer_name: args.customer.name,
      billing_last_name: '',
      billing_address: args.customer.address1,
      billing_city: args.customer.city,
      billing_pincode: args.customer.zipcode,
      billing_state: args.customer.state,
      billing_country: args.customer.country,
      billing_email: '',
      billing_phone: args.customer.phone,
      billing_alternate_phone: '',
      shipping_is_billing: true,
      order_items: args.items,
      payment_method: args.codAmount > 0 ? 'COD' : 'Prepaid',
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: args.items.reduce((s, i) => s + i.selling_price * i.units, 0),
      length: 20,
      breadth: 15,
      height: 5,
      weight: Math.max(0.5, args.weightGrams / 1000),
    }),
  });
  return data as any;
}

export async function syncShiprocketOrders() {
  if (!hasShiprocket()) return log('shiprocket creds missing — skipping shipment sync');
  try {
    const data: any = await shipApi('/shipments?page=1&per_page=50');
    const list = data.data?.data ?? [];
    for (const s of list) {
      const orderId = /^\d+$/.test(s.order_id ?? '') ? BigInt(s.order_id) : null;
      await query(
        `INSERT INTO shipments (id, order_id, awb_code, courier_name, status, cost, cod_amount, cod_fee, weight_g, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT (id) DO UPDATE SET order_id=EXCLUDED.order_id, awb_code=EXCLUDED.awb_code,
           courier_name=EXCLUDED.courier_name, status=EXCLUDED.status, cost=EXCLUDED.cost,
           cod_amount=EXCLUDED.cod_amount, cod_fee=EXCLUDED.cod_fee, weight_g=EXCLUDED.weight_g,
           data=EXCLUDED.data, updated_at=now()`,
        [s.shipment_id, orderId, s.awb_code ?? null, s.courier_name ?? null, s.status ?? 'pending',
         s.charges?.freight_charge ?? null, s.cod_amount ?? null, s.charges?.cod_charge ?? null,
         s.weight ?? null, JSON.stringify(s)],
      );
    }
    log(`shiprocket shipments synced: ${list.length}`);
  } catch (err: any) {
    log('shiprocket sync failed:', err.message);
  }
}