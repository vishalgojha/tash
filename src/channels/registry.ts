import { query, pool } from '../db/pool.js';
import { log } from '../config.js';

export type ChannelKind = 'shopify' | 'marketplace' | 'd2c' | 'social';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  feePct: number;
  codFeePct: number;
  fixedFee: number;
  config: Record<string, unknown>;
}

export async function listChannels(): Promise<Channel[]> {
  const { rows } = await query(
    `SELECT id, name, kind, fee_pct, cod_fee_pct, fixed_fee, config, is_active
     FROM channels ORDER BY kind, name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    feePct: Number(r.fee_pct),
    codFeePct: Number(r.cod_fee_pct),
    fixedFee: Number(r.fixed_fee),
    config: r.config,
  }));
}

export async function getChannel(id: string): Promise<Channel | null> {
  const { rows } = await query(`SELECT id, name, kind, fee_pct, cod_fee_pct, fixed_fee, config, is_active FROM channels WHERE id=$1`, [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    feePct: Number(r.fee_pct),
    codFeePct: Number(r.cod_fee_pct),
    fixedFee: Number(r.fixed_fee),
    config: r.config,
  };
}

export interface ListingInput {
  channelId: string;
  sku: string;
  externalId?: string;
  title: string;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  status?: string;
  weightGrams?: number | null;
  productData?: Record<string, unknown>;
}

export async function upsertListing(l: ListingInput) {
  await query(
    `INSERT INTO channel_listings (channel_id, product_id, variant_id, external_id, sku, title, price,
                                   compare_at_price, stock, status, weight_g, data, last_synced_at)
     VALUES ($1, (SELECT v.product_id FROM product_variants v JOIN channel_listings cl ON cl.variant_id=v.id WHERE cl.channel_id='shopify' AND cl.sku=$2 LIMIT 1),
             (SELECT variant_id FROM channel_listings WHERE channel_id='shopify' AND sku=$2 LIMIT 1),
             $3,$2,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (channel_id, sku) DO UPDATE SET
       product_id=EXCLUDED.product_id, variant_id=EXCLUDED.variant_id, external_id=EXCLUDED.external_id,
       title=EXCLUDED.title, price=EXCLUDED.price, compare_at_price=EXCLUDED.compare_at_price,
       stock=EXCLUDED.stock, status=EXCLUDED.status, weight_g=EXCLUDED.weight_g, data=EXCLUDED.data,
       last_synced_at=now()`,
    [l.channelId, l.sku, l.externalId ?? null, l.title, l.price, l.compareAtPrice ?? null, l.stock,
     l.status ?? 'active', l.weightGrams ?? null, JSON.stringify(l.productData ?? {})],
  );
}

export async function getListingBySku(channelId: string, sku: string) {
  const { rows } = await query(
    `SELECT * FROM channel_listings WHERE channel_id=$1 AND sku=$2`,
    [channelId, sku],
  );
  return rows[0] ?? null;
}

/** Import a marketplace feed (CSV or JSON array) into a channel as listings. */
export async function importListings(channelId: string, records: ListingInput[]) {
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (const r of records) {
      const { rows } = await client.query(
        `INSERT INTO channel_listings (channel_id, product_id, variant_id, external_id, sku, title, price,
                                       compare_at_price, stock, status, weight_g, data, last_synced_at)
         VALUES ($1,
                 (SELECT v.product_id FROM product_variants v JOIN channel_listings cl ON cl.variant_id=v.id WHERE cl.channel_id='shopify' AND cl.sku=$2 LIMIT 1),
                 (SELECT variant_id FROM channel_listings WHERE channel_id='shopify' AND sku=$2 LIMIT 1),
                 $3,$2,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT (channel_id, sku) DO UPDATE SET
           product_id=EXCLUDED.product_id, variant_id=EXCLUDED.variant_id, external_id=EXCLUDED.external_id,
           title=EXCLUDED.title, price=EXCLUDED.price, compare_at_price=EXCLUDED.compare_at_price,
           stock=EXCLUDED.stock, status=EXCLUDED.status, weight_g=EXCLUDED.weight_g, data=EXCLUDED.data,
           last_synced_at=now()
         RETURNING sku`,
        [channelId, r.sku, r.externalId ?? null, r.title, r.price, r.compareAtPrice ?? null, r.stock,
         r.status ?? 'active', r.weightGrams ?? null, JSON.stringify(r.productData ?? {})],
      );
      if (rows.length) written++;
    }
    await client.query('COMMIT');
    log(`imported ${written} listings into channel ${channelId}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { written };
}

/** Myntra adapter placeholder: expects an API key / email + a feed import.
 *  Myntra's seller APIs cap inventory/price updates; until live creds are granted
 *  use importListings('myntra', records) from a CSV of {sku,price,stock,...}. */
export async function syncMyntraInventory() {
  const email = process.env.MYNTRA_API_KEY ?? '';
  if (!email) return log('myntra api key missing — skipping (use importListings with a feed CSV instead)');
  // TODO: implement Myntra seller API auth + bulk inventory/price push once creds provided.
  throw new Error('myntra live API not yet wired — awaiting seller credentials');
}