-- 005_business_os.sql
-- Business OS: targets, per-SKU cost & planning breakdown, order economics,
-- marketing (Meta Ads) ingestion, and reconciliation tracking.

-- --- Cost model: full SKU cost breakdown (true cost = vendor + embellishment + packaging) ---
ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS vendor_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embellishment NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days  INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS safety_days     INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS target_cover_days INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS classification   TEXT DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT true;

-- --- Business targets / planning assumptions (the founder dashboard numbers) ---
CREATE TABLE IF NOT EXISTS business_plan (
  key   TEXT PRIMARY KEY,
  value NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit  TEXT DEFAULT 'inr',              -- inr | orders | percent
  label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO business_plan (key, value, unit, label) VALUES
  ('monthly_profit_target',     100000, 'inr',    'Monthly operating-profit target'),
  ('fixed_costs',               100000, 'inr',    'Assumed monthly fixed costs'),
  ('working_capital_reference', 150000, 'inr',    'Working-capital reference'),
  ('meta_monthly_spend',         45000, 'inr',    'Meta (FB/IG) monthly planning spend'),
  ('contribution_target',       200000, 'inr',    'Required monthly contribution'),
  ('contribution_per_order',      1571, 'inr',    'Contribution per order'),
  ('target_orders_month',          128, 'orders', 'Required orders to hit profit target')
ON CONFLICT (key) DO NOTHING;

-- Per-SKU planning overrides (lead time, safety stock, target cover, forced classification)
CREATE TABLE IF NOT EXISTS sku_planning (
  sku               TEXT PRIMARY KEY REFERENCES product_costs(sku) ON DELETE CASCADE,
  lead_time_days    INTEGER,
  safety_days       INTEGER,
  target_cover_days INTEGER,
  reorder_qty_min   INTEGER NOT NULL DEFAULT 0,
  status            TEXT DEFAULT 'auto',       -- auto | reorder | healthy | review | stocked_out
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Marketing: Meta Ads daily campaign/ad cost ingestion ---
CREATE TABLE IF NOT EXISTS meta_ads (
  id              BIGSERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  campaign_name   TEXT NOT NULL DEFAULT '',
  adset_name      TEXT NOT NULL DEFAULT '',
  ad_name         TEXT NOT NULL DEFAULT '',
  spend           NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  reach           BIGINT NOT NULL DEFAULT 0,
  purchases       NUMERIC(10,2) NOT NULL DEFAULT 0,
  purchase_value  NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_roas   NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_per_purchase NUMERIC(10,2) NOT NULL DEFAULT 0,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (date, ad_name)
);
CREATE INDEX IF NOT EXISTS idx_meta_ads_date ON meta_ads(date);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON meta_ads(campaign_name, date);

-- --- Order-level economics: per-order cost allocation + contribution ---
CREATE TABLE IF NOT EXISTS order_costs (
  order_id            BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  channel_id          TEXT REFERENCES channels(id) ON DELETE SET NULL,
  revenue             NUMERIC(14,2) NOT NULL DEFAULT 0,   -- gross billed
  revenue_net_gst     NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  product_cost_total  NUMERIC(14,2) NOT NULL DEFAULT 0,   -- true cost of items (vendor+vap+packaging)
  shipping_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_charged    NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_fee         NUMERIC(14,2) NOT NULL DEFAULT 0,   -- razorpay / gateway fee
  cod_fee             NUMERIC(14,2) NOT NULL DEFAULT 0,
  marketplace_fee     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- platform commission
  rto_penalty         NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_deductions    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ad_cost             NUMERIC(14,2) NOT NULL DEFAULT 0,   -- attributed advertising spend
  contribution_pre_ads  NUMERIC(14,2) NOT NULL DEFAULT 0,
  contribution_after_ads NUMERIC(14,2) NOT NULL DEFAULT 0,
  reconciled          BOOLEAN NOT NULL DEFAULT false,
  recomputed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Reconciliation fields on orders ---
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel_id TEXT NOT NULL DEFAULT 'shopify',
  ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'shopify',   -- shopify | myntra | amazon | nykaa | manual
  ADD COLUMN IF NOT EXISTS source_id  TEXT,
  ADD COLUMN IF NOT EXISTS gateway     TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS reconciled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rto_penalty  NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_created_covered ON orders(created_at);