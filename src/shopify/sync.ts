import { query, pool } from '../db/pool.js';
import type {
  ShopifyProduct,
  ShopifyVariant,
  ShopifyCustomer,
  ShopifyOrder,
  ShopifyCollection,
} from '../types.js';
import {
  storefrontProducts,
  storefrontCollections,
  getCollectionProducts,
  adminCustomers,
  adminOrders,
} from './client.js';
import { hasAdminAccess, log, hasShiprocket } from '../config.js';
import { syncShiprocketOrders } from '../shiprocket/client.js';

const CHANNEL = 'shopify';

async function logSync(kind: string, status: string, seen: number, written: number, message?: string) {
  await query(
    `INSERT INTO sync_log (source, kind, status, items_seen, items_written, message, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    ['shopify', kind, status, seen, written, message ?? null],
  );
}

export async function syncCatalog(): Promise<void> {
  const seen = { products: 0, variants: 0 };
  const started = Date.now();
  await query(`DELETE FROM sync_log WHERE source='shopify' AND status='running'`);
  await query(
    `INSERT INTO sync_log (source, kind, status, started_at) VALUES ('shopify','catalog','running', now())`,
  );

  try {
    for await (const page of storefrontProducts()) {
      for (const p of page) {
        await upsertProduct(p);
        seen.products++;
        seen.variants += p.variants.length;
      }
    }
    await syncCollections();
    resolveCollectionMembership();
    await query(`UPDATE sync_log SET status='done', items_seen=$1, items_written=$2, finished_at=now()
                 WHERE source='shopify' AND kind='catalog' AND status='running'`, [seen.products, seen.variants]);
    log(`catalog sync done: ${seen.products} products, ${seen.variants} variants in ${Date.now() - started}ms`);
  } catch (err: any) {
    await query(`UPDATE sync_log SET status='failed', message=$1, finished_at=now()
                 WHERE source='shopify' AND kind='catalog' AND status='running'`, [String(err?.message ?? err)]);
    throw err;
  }
}

async function upsertProduct(p: ShopifyProduct) {
  const prices = p.variants.map((v) => Number(v.price) || 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  const available = p.variants.some((v) => v.available);

  await query(
    `INSERT INTO products (id, handle, title, body_html, vendor, product_type, tags, status, options, images,
                           published_at, created_at, updated_at, price_min, price_max, available, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
     ON CONFLICT (id) DO UPDATE SET
       handle=EXCLUDED.handle, title=EXCLUDED.title, body_html=EXCLUDED.body_html,
       vendor=EXCLUDED.vendor, product_type=EXCLUDED.product_type, tags=EXCLUDED.tags,
       status=EXCLUDED.status, options=EXCLUDED.options, images=EXCLUDED.images,
       published_at=EXCLUDED.published_at, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
       price_min=EXCLUDED.price_min, price_max=EXCLUDED.price_max, available=EXCLUDED.available,
       last_synced_at=now()`,
    [p.id, p.handle, p.title, p.body_html ?? '', p.vendor, p.product_type, p.tags, p.status,
     JSON.stringify(p.options), JSON.stringify(p.images), p.published_at, p.created_at, p.updated_at,
     priceMin, priceMax, available],
  );

  for (const v of p.variants) {
    await upsertVariant(v, p);
    await upsertListing(v, p);
  }
}

async function upsertVariant(v: ShopifyVariant, p: ShopifyProduct) {
  await query(
    `INSERT INTO product_variants (id, product_id, title, sku, barcode, price, compare_at_price, option1, option2,
                                   option3, position, requires_shipping, taxable, available, inventory_quantity,
                                   weight, weight_unit, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET
       product_id=EXCLUDED.product_id, title=EXCLUDED.title, sku=EXCLUDED.sku, barcode=EXCLUDED.barcode,
       price=EXCLUDED.price, compare_at_price=EXCLUDED.compare_at_price, option1=EXCLUDED.option1,
       option2=EXCLUDED.option2, option3=EXCLUDED.option3, position=EXCLUDED.position,
       requires_shipping=EXCLUDED.requires_shipping, taxable=EXCLUDED.taxable, available=EXCLUDED.available,
       inventory_quantity=EXCLUDED.inventory_quantity, weight=EXCLUDED.weight, weight_unit=EXCLUDED.weight_unit,
       created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`,
    [v.id, v.product_id, v.title, v.sku ?? null, v.barcode ?? null, v.price, v.compare_at_price ?? null,
     v.option1 ?? null, v.option2 ?? null, v.option3 ?? null, v.position, v.requires_shipping, v.taxable,
     v.available, v.inventory_quantity, v.weight ?? 0, v.weight_unit ?? 'g', v.created_at, v.updated_at],
  );
}

async function upsertListing(v: ShopifyVariant, p: ShopifyProduct) {
  const sku = v.sku || `${p.handle}-${v.id}`;
  await query(
    `INSERT INTO channel_listings (channel_id, product_id, variant_id, external_id, sku, title, price,
                                   compare_at_price, stock, status, weight_g, data, last_synced_at)
     VALUES ('shopify',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (channel_id, sku) DO UPDATE SET
       product_id=EXCLUDED.product_id, variant_id=EXCLUDED.variant_id, external_id=EXCLUDED.external_id,
       title=EXCLUDED.title, price=EXCLUDED.price, compare_at_price=EXCLUDED.compare_at_price,
       stock=EXCLUDED.stock, status=EXCLUDED.status, weight_g=EXCLUDED.weight_g, data=EXCLUDED.data,
       last_synced_at=now()`,
    ['shopify', p.id, v.id, String(v.id), sku, v.title, v.price, v.compare_at_price ?? null,
     v.available ? (v.inventory_quantity > 0 ? v.inventory_quantity : null) : 0,
     v.available ? 'active' : 'unavailable', v.weight ?? 0,
     JSON.stringify({ handle: p.handle, product_id: String(p.id), image: p.images[0]?.src ?? null })],
  );
}

async function syncCollections() {
  const byId = new Map<number, ShopifyCollection>();
  for await (const page of storefrontCollections()) {
    for (const c of page) {
      byId.set(c.id, c);
      await query(
        `INSERT INTO collections (id, handle, title, body_html, sort_order, published_at, updated_at, image, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle, title=EXCLUDED.title,
           body_html=EXCLUDED.body_html, sort_order=EXCLUDED.sort_order, published_at=EXCLUDED.published_at,
           updated_at=EXCLUDED.updated_at, image=EXCLUDED.image, last_synced_at=now()`,
        [c.id, c.handle, c.title, c.body_html ?? '', c.sort_order, c.published_at, c.updated_at, c.image ? JSON.stringify(c.image) : null],
      );
    }
  }
  log(`collections loaded: ${byId.size}`);
}

async function resolveCollectionMembership() {
  await query(`DELETE FROM collection_products`);
  for await (const page of storefrontCollections()) {
    for (const c of page) {
      const products = await getCollectionProducts(c.id);
      if (!products.length) continue;
      const rows = products.map((p, i) => [c.id, p.id, i]);
      const client = await pool.connect();
      try {
        for (const [cid, pid, pos] of rows) {
          await client.query(
            `INSERT INTO collection_products (collection_id, product_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [cid, pid, pos],
          );
        }
      } finally {
        client.release();
      }
    }
  }
}

export async function syncCustomers() {
  if (!hasAdminAccess()) return log('admin token missing — skipping customers');
  let seen = 0;
  for await (const page of adminCustomers()) {
    for (const c of page) {
      await query(
        `INSERT INTO customers (id, email, first_name, last_name, phone, orders_count, total_spent, currency,
                                tags, note, created_at, updated_at, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, first_name=EXCLUDED.first_name,
           last_name=EXCLUDED.last_name, phone=EXCLUDED.phone, orders_count=EXCLUDED.orders_count,
           total_spent=EXCLUDED.total_spent, currency=EXCLUDED.currency, tags=EXCLUDED.tags,
           note=EXCLUDED.note, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
           last_synced_at=now()`,
        [c.id, c.email ?? null, c.first_name ?? null, c.last_name ?? null, c.phone ?? null,
         c.orders_count, c.total_spent, c.currency ?? null,
         (c.tags || '').split(',').filter(Boolean), c.note ?? null, c.created_at, c.updated_at],
      );
      seen++;
    }
  }
  await logSync('customers', 'done', seen, seen);
  log(`customers synced: ${seen}`);
}

export async function syncOrders({
  syncShipment = hasShiprocket(),
  shiprocketOnly = false,
}: { syncShipment?: boolean; shiprocketOnly?: boolean } = {}) {
  if (shiprocketOnly) {
    await syncShiprocketOrders();
    return;
  }
  if (!hasAdminAccess()) return log('admin token missing — skipping orders');
  let seen = 0;
  for await (const page of adminOrders()) {
    for (const o of page) {
      await upsertOrder(o);
      seen++;
    }
    await logSync('orders', 'page', seen, seen);
  }
  await logSync('orders', 'done', seen, seen);
  log(`orders synced: ${seen}`);
  if (syncShipment) await syncShiprocketOrders();
}

async function upsertOrder(o: ShopifyOrder) {
  let customerId: number | null = null;
  if (o.customer) {
    const c = o.customer;
    await query(
      `INSERT INTO customers (id, email, first_name, last_name, phone, orders_count, total_spent, currency,
                              tags, note, created_at, updated_at, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name, phone=EXCLUDED.phone, tags=EXCLUDED.tags, note=EXCLUDED.note,
         updated_at=EXCLUDED.updated_at, last_synced_at=now()
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.email ?? null, c.first_name ?? null, c.last_name ?? null, c.phone ?? null, c.orders_count,
       c.total_spent, c.currency ?? null, (c.tags || '').split(',').filter(Boolean), c.note ?? null,
       c.created_at, c.updated_at],
    );
    customerId = c.id;
  }

  await query(
    `INSERT INTO orders (id, name, email, phone, financial_status, fulfillment_status, currency, subtotal_price,
                         total_price, total_discounts, total_shipping, customer, customer_id, line_items, tags,
                         created_at, updated_at, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone,
       financial_status=EXCLUDED.financial_status, fulfillment_status=EXCLUDED.fulfillment_status,
       currency=EXCLUDED.currency, subtotal_price=EXCLUDED.subtotal_price, total_price=EXCLUDED.total_price,
       total_discounts=EXCLUDED.total_discounts, total_shipping=EXCLUDED.total_shipping,
       customer=EXCLUDED.customer, customer_id=EXCLUDED.customer_id, line_items=EXCLUDED.line_items,
       tags=EXCLUDED.tags, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at, last_synced_at=now()`,
    [o.id, o.name ?? null, o.email ?? null, o.phone ?? null, o.financial_status ?? null,
     o.fulfillment_status ?? null, o.currency ?? null, o.subtotal_price, o.total_price, o.total_discounts,
     o.total_shipping ?? null, o.customer ? JSON.stringify(o.customer) : null, customerId,
     JSON.stringify(o.line_items ?? []), (o.tags || '').split(',').filter(Boolean), o.created_at, o.updated_at],
  );
}

export async function syncAll(opts?: { sync?: boolean }) {
  await syncCatalog();
  await syncCustomers();
  await syncOrders();
  if (opts?.sync !== false && hasShiprocket()) await syncShiprocketOrders();
}