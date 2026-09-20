import { env, log } from '../config.js';
import { query } from '../db/pool.js';
import { createHmac } from 'node:crypto';

const BASE = 'https://api.razorpay.com/v1';

export const hasRazorpay = () => Boolean(env.razorpayKeyId && env.razorpaySecret);

function authHeader() {
  return 'Basic ' + Buffer.from(`${env.razorpayKeyId}:${env.razorpaySecret}`).toString('base64');
}

async function rp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Razorpay ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface RpOrder {
  id: string;
  receipt?: string | null;
  amount: number; // paise
  currency: string;
  status: string;
  attempts: number;
  notes: Record<string, any>;
}

export async function createOrder(args: {
  amountPaise: number;
  receipt?: string;
  notes?: Record<string, string>;
  method?: 'upi' | 'card' | 'netbanking' | 'emi';
}): Promise<RpOrder> {
  return rp<RpOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: 'INR',
      receipt: args.receipt ?? `txn_${Date.now()}`,
      ...(args.method ? { method: args.method } : {}),
      notes: args.notes ?? {},
    }),
  });
}

export async function fetchOrder(id: string): Promise<RpOrder> {
  return rp<RpOrder>(`/orders/${id}`);
}

export interface RpPayment {
  id: string;
  order_id?: string;
  status: string; // captured | failed | authorized | refunded
  amount: number;
  method: string;
  captured: boolean;
  fee?: number;
  tax?: number;
  error_description?: string | null;
}

export async function fetchPayment(id: string): Promise<RpPayment> {
  return rp<RpPayment>(`/payments/${id}`);
}

export async function paymentsForOrder(orderId: string): Promise<RpPayment[]> {
  const data = await rp<any>(`/orders/${orderId}/payments`);
  return (data.items ?? []) as RpPayment[];
}

export async function createRefund(paymentId: string, amountPaise?: number, notes?: string) {
  return rp<any>(`/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      ...(amountPaise ? { amount: amountPaise } : {}),
      ...(notes ? { notes: { note: notes } } : {}),
    }),
  });
}

export interface RpSettlement {
  id: string;
  amount: number;
  status: string;
  fees: number;
  tax: number;
  utr?: string | null;
  settlement_date?: string | null;
}

export async function settlements(from?: string, to?: string): Promise<RpSettlement[]> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  qs.set('count', '100');
  qs.set('skip', '0');
  const data = await rp<any>(`/settlements?${qs.toString()}`);
  return (data.items ?? []) as RpSettlement[];
}

/** Verify a Razorpay webhook: HMAC-SHA256(rawBody, webhookSecret). */
export function verifyWebhookSignature(rawBody: string, signature: string, secret = env.razorpayWebhookSecret): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}

export async function recordEvent(e: {
  razorpayId: string;
  entity: string;
  event: string;
  amountPaise?: number;
  payload: any;
}) {
  await query(
    `INSERT INTO razorpay_events (razorpay_id, entity, event, amount, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (razorpay_id, event) DO NOTHING`,
    [e.razorpayId, e.entity, e.event, e.amountPaise ? e.amountPaise / 100 : null, JSON.stringify(e.payload ?? {})],
  );
}

export async function markEventProcessed(razorpayId: string, event: string) {
  await query(`UPDATE razorpay_events SET processed=true WHERE razorpay_id=$1 AND event=$2`, [razorpayId, event]);
}

export function logRazorpay(msg: string) {
  log(`razorpay: ${msg}`);
}