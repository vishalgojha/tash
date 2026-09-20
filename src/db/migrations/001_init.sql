CREATE TABLE IF NOT EXISTS products (
  id            BIGINT PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL DEFAULT '',
  body_html     TEXT NOT NULL DEFAULT '',
  vendor        TEXT NOT NULL DEFAULT '',
  product_type  TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active',
  options       JSONB NOT NULL DEFAULT '[]'::jsonb,
  images        JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  price_min     NUMERIC(12, 2),
  price_max     NUMERIC(12, 2),
  available     BOOLEAN NOT NULL DEFAULT false,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id                  BIGINT PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title               TEXT NOT NULL DEFAULT '',
  sku                 TEXT,
  barcode             TEXT,
  price               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  compare_at_price    NUMERIC(12, 2),
  option1             TEXT,
  option2             TEXT,
  option3             TEXT,
  position            INTEGER NOT NULL DEFAULT 1,
  requires_shipping   BOOLEAN NOT NULL DEFAULT true,
  taxable             BOOLEAN NOT NULL DEFAULT true,
  available           BOOLEAN NOT NULL DEFAULT false,
  inventory_quantity  INTEGER NOT NULL DEFAULT 0,
  weight              NUMERIC(10, 2) DEFAULT 0,
  weight_unit         TEXT,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS collections (
  id           BIGINT PRIMARY KEY,
  handle       TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  sort_order   TEXT NOT NULL DEFAULT 'manual',
  published_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  image        JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_products (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id            BIGINT PRIMARY KEY,
  email         TEXT,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  orders_count  INTEGER NOT NULL DEFAULT 0,
  total_spent   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency      TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  note          TEXT,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                  BIGINT PRIMARY KEY,
  name                TEXT,
  email               TEXT,
  phone               TEXT,
  financial_status    TEXT,
  fulfillment_status  TEXT,
  currency            TEXT,
  subtotal_price      NUMERIC(14, 2) DEFAULT 0,
  total_price         NUMERIC(14, 2) DEFAULT 0,
  total_discounts     NUMERIC(14, 2) DEFAULT 0,
  total_shipping      NUMERIC(14, 2) DEFAULT 0,
  customer            JSONB,
  customer_id         BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS sync_log (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  items_seen    INTEGER NOT NULL DEFAULT 0,
  items_written INTEGER NOT NULL DEFAULT 0,
  message       TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);