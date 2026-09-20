import { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import {
  hasRazorpay,
  createOrder,
  fetchOrder,
  fetchPayment,
  paymentsForOrder,
  createRefund,
  settlements,
  verifyWebhookSignature,
  recordEvent,
  markEventProcessed,
} from '../../razorpay/client.js';

export async function paymentsRoutes(app: FastifyInstance) {
  // Health of the payment module
  app.get('/payments/status', async () => ({
    razorpay: hasRazorpay() ? 'configured' : 'missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET',
  }));

  // Create a Razorpay Order for a local order (or ad-hoc amount)
  app.post('/payments/razorpay/order', async (req, reply) => {
    const b = req.body as { order_id?: bigint; order_name?: string; amount?: number; method?: string };
    if (!hasRazorpay()) return reply.code(503).send({ error: 'razorpay not configured' });
    let amountPaise = b.amount ? Math.round(b.amount * 100) : 0;
    let localOrder: string | null = b.order_name ?? null;
    if (b.order_id) {
      const { rows } = await query(`SELECT id, name, total_price FROM orders WHERE id=$1`, [b.order_id]);
      if (!rows.length) return reply.code(404).send({ error: 'order not found' });
      amountPaise = Math.round(Number(rows[0].total_price) * 100);
      localOrder = rows[0].name ?? String(b.order_id);
    }
    if (amountPaise <= 0) return reply.code(400).send({ error: 'amount required (or valid order_id)' });
    const order = await createOrder({
      amountPaise,
      receipt: localOrder ?? undefined,
      notes: b.order_id ? { order_id: String(b.order_id) } : undefined,
      method: b.method as any,
    });
    await query(
      `INSERT INTO razorpay_orders (id, order_id, local_order_name, amount, currency, status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'INR','created',$5,now(),now())
       ON CONFLICT (id) DO UPDATE SET order_id=EXCLUDED.order_id, amount=EXCLUDED.amount, updated_at=now()`,
      [order.id, b.order_id ? String(b.order_id) : null, localOrder, order.amount / 100, JSON.stringify(order)],
    );
    return { razorpay: order, amountPaise, amountInr: amountPaise / 100, currency: 'INR', key_id: process.env.RAZORPAY_KEY_ID };
  });

  // Fetch a payment/order (poll status)
  app.get('/payments/razorpay/order/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const order = await fetchOrder(id);
      const payments = await paymentsForOrder(id);
      await query(`UPDATE razorpay_orders SET status=$1, data=$2, updated_at=now() WHERE id=$3`, [
        order.status,
        JSON.stringify({ ...order, payments }),
        id,
      ]);
      return { order, payments };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // Webhook receiver for Razorpay payment/refund/settlement events
  app.post('/payments/razorpay/webhook', async (req, reply) => {
    const sig = (req.headers['x-razorpay-signature'] as string) ?? '';
    const raw = ((req as any).rawBody as string) ?? JSON.stringify(req.body);
    if (!verifyWebhookSignature(raw, sig)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    const evt = (req.body ?? {}) as any;
    const entity = evt.payload?.payment?.entity ?? evt.payload?.refund?.entity ?? evt.payload?.settlement?.entity;
    const event = String(evt.event ?? 'unknown');

    const razorpayId =
      entity?.id ?? entity?.payment_id ?? (evt.payload?.refund?.entity?.id) ?? `evt_${Date.now()}`;
    const amountPaise = Number(entity?.amount ?? 0);
    await recordEvent({ razorpayId, entity: entity?.entity ?? 'unknown', event, amountPaise, payload: evt });

    // payment.captured -> mark the local order paid
    if (event === 'payment.captured' && entity?.order_id) {
      await query(
        `UPDATE razorpay_orders SET status='paid', payment_id=$2, captured_amount=$3, fee=$4, gst=$5, method=$6, updated_at=now()
          WHERE id=$1`,
        [entity.order_id, entity.id, amountPaise / 100, (entity.fee ?? 0) / 100, (entity.tax ?? 0) / 100, entity.method],
      );
      const o = await query(`SELECT order_id FROM razorpay_orders WHERE id=$1`, [entity.order_id]);
      if (o.rows[0]?.order_id) {
        await query(
          `UPDATE orders SET financial_status='paid', last_synced_at=now() WHERE id=$1 AND financial_status IS DISTINCT FROM 'paid'`,
          [o.rows[0].order_id],
        );
      }
    }
    if (event === 'payment.failed' && entity?.order_id) {
      await query(`UPDATE razorpay_orders SET status='failed', updated_at=now() WHERE id=$1`, [entity.order_id]);
    }
    if ((event === 'refund.processed' || event === 'refund.created') && entity) {
      await query(
        `INSERT INTO razorpay_refunds (id, payment_id, order_local_id, amount, status, reason, created_at)
         VALUES ($1,$2,$3,$4,'processed',$5,now())
         ON CONFLICT (id) DO UPDATE SET status='processed'`,
        [entity.id, entity.payment_id ?? '', entity.order_id ?? null, amountPaise / 100, entity.reason ?? null],
      );
    }
    await markEventProcessed(razorpayId, event);
    return { ok: true, event, razorpay_id: razorpayId };
  });

  // Initiate a refund
  app.post('/payments/razorpay/refund', async (req, reply) => {
    const b = req.body as { payment_id: string; amount?: number; note?: string };
    if (!b.payment_id) return reply.code(400).send({ error: 'payment_id required' });
    try {
      const refund = await createRefund(b.payment_id, b.amount ? Math.round(b.amount * 100) : undefined, b.note);
      return { refund };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // Settlement reconciliation (money that reached your bank, net of fees)
  app.get('/payments/razorpay/settlements', async (req, reply) => {
    if (!hasRazorpay()) return reply.code(503).send({ error: 'razorpay not configured' });
    const q = req.query as { from?: string; to?: string };
    try {
      const items = await settlements(q.from, q.to);
      const { rows } = await query(
        `SELECT count(*)::int AS n, coalesce(sum(amount),0)::numeric AS amt FROM razorpay_events WHERE entity='settlement'`,
      );
      return { settlements: items, stored: rows[0] };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // Local ledger of razorpay orders/events
  app.get('/payments/razorpay/ledger', async (req) => {
    const q = req.query as { limit?: string; from?: string; to?: string };
    const where: string[] = [];
    const p: unknown[] = [];
    let i = 1;
    if (q.from) {
      where.push(`created_at >= $${i++}`);
      p.push(new Date(q.from).toISOString());
    }
    if (q.to) {
      where.push(`created_at <= $${i++}`);
      p.push(new Date(q.to).toISOString());
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const orders = await query(
      `SELECT * FROM razorpay_orders ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
      p,
    );
    const events = await query(
      `SELECT razorpay_id, entity, event, amount, status, processed, created_at FROM razorpay_events ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
      p,
    );
    return { orders: orders.rows, events: events.rows };
  });

  // Payment-detail helper used by agent order tracking
  app.get('/payments/razorpay/payment/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { payment: await fetchPayment(id) };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
  });
}