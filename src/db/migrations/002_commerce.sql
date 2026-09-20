CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'marketplace', -- shopify | marketplace | d2c | social
  base_currency TEXT NOT NULL DEFAULT 'INR',
  fee_pct     NUMERIC(5, 2) NOT NULL DEFAULT 0,      -- platform commission %
  cod_fee_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,      -- COD handling fee %
  fixed_fee   NUMERIC(12, 2) NOT NULL DEFAULT 0,     -- per-order fixed fee
  ship_fee_source TEXT NOT NULL DEFAULT 'shiprocket', -- how shipping cost is derived
  is_active   BOOLEAN NOT NULL DEFAULT true,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO channels (id, name, kind, fee_pct, cod_fee_pct, config)
VALUES ('shopify', 'Shopify Store (tashbags.com)',        'd2c',        0, 0, '{"storefront":"https://tashbags.com"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, name, kind, fee_pct, cod_fee_pct, config)
VALUES ('myntra',  'Myntra',                              'marketplace', 0, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Unified listing per channel, linked back to the same physical product via SKU.
CREATE TABLE IF NOT EXISTS channel_listings (
  id            BIGSERIAL PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  product_id    BIGINT REFERENCES products(id) ON DELETE SET NULL,
  variant_id    BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  external_id   TEXT,                       -- id on the channel (shopify variant id, myntra style id...)
  sku           TEXT,                       -- canonical sync key across all channels
  title         TEXT NOT NULL DEFAULT '',
  price         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  compare_at_price NUMERIC(12, 2),
  stock         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active', -- active | inactive | archived | unavailable
  weight_g      NUMERIC(10, 2),
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_listings_product ON channel_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_variant ON channel_listings(variant_id);
CREATE INDEX IF NOT EXISTS idx_listings_sku ON channel_listings(sku);

-- Cost of goods per SKU (your purchase / making cost).
CREATE TABLE IF NOT EXISTS product_costs (
  sku           TEXT PRIMARY KEY,
  product_id    BIGINT REFERENCES products(id) ON DELETE CASCADE,
  variant_id    BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
  cost          NUMERIC(12, 2) NOT NULL DEFAULT 0, -- landed / making cost in INR
  hsn           TEXT,
  gst_pct       NUMERIC(5, 2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only stock ledger for every stock movement across channels.
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id            BIGSERIAL PRIMARY KEY,
  sku           TEXT NOT NULL,
  variant_id    BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  channel_id    TEXT REFERENCES channels(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,              -- purchase | sale | return | adjustment | sync
  reference     TEXT,                       -- order id / awb / file ref / shopify inventory id
  note          TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_sku ON inventory_ledger(sku, occurred_at);

-- ShipRocket shipment lifecycle (COD reconciliation lives on order + shipment).
CREATE TABLE IF NOT EXISTS shipments (
  id            VARCHAR(64) PRIMARY KEY,    -- shiprocket shipment_id
  order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  order_rate_id TEXT,
  awb_code      TEXT,
  courier_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  cost          NUMERIC(12, 2),
  cod_amount    NUMERIC(12, 2),
  cod_fee       NUMERIC(12, 2),
  length_cm     NUMERIC(8, 2),
  breadth_cm    NUMERIC(8, 2),
  height_cm     NUMERIC(8, 2),
  weight_g      NUMERIC(10, 2),
  estimated_delivery TIMESTAMPTZ,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

-- WhatsApp AI agent conversations (whatsmeow/WAHA session).
CREATE TABLE IF NOT EXISTS agent_chats (
  id            BIGSERIAL PRIMARY KEY,
  wa_session    TEXT NOT NULL DEFAULT 'default',
  wa_chat_id    TEXT NOT NULL,
  contact_name  TEXT,
  is_owner      BOOLEAN NOT NULL DEFAULT false,
  intent        TEXT,
  reply         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_chats_chat ON agent_chats(wa_chat_id, created_at DESC);