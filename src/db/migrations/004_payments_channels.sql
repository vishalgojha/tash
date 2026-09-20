-- Extra marketplace channels (fee_pct = typical platform commission; tune via API/DB)
INSERT INTO channels (id, name, kind, fee_pct, cod_fee_pct, config)
VALUES ('nykaa',  'Nykaa Fashion', 'marketplace', 25, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, name, kind, fee_pct, cod_fee_pct, config)
VALUES ('amazon', 'Amazon India',   'marketplace', 25, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, name, kind, fee_pct, cod_fee_pct, config)
VALUES ('amazon_intl', 'Amazon (international)', 'marketplace', 25, 0, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Razorpay order/payment tracking for reconciliation (payments + settlements + refunds)
CREATE TABLE IF NOT EXISTS razorpay_orders (
  id                TEXT PRIMARY KEY,          -- razorpay order id (order_...)
  order_id          BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  local_order_name  TEXT,                      -- e.g. #1001 for human matching
  amount            NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- in INR
  currency          TEXT NOT NULL DEFAULT 'INR',
  status            TEXT NOT NULL DEFAULT 'created',      -- created | attempted | paid
  method            TEXT,                     -- card | upi | netbanking | cod...
  payment_id        TEXT,                     -- pay_... most recent payment
  captured_amount   NUMERIC(14, 2) DEFAULT 0,
  fee               NUMERIC(12, 2) DEFAULT 0, -- razorpay payment fee
  gst               NUMERIC(12, 2) DEFAULT 0, -- razorpay fee gst
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS razorpay_events (
  id            BIGSERIAL PRIMARY KEY,
  razorpay_id   TEXT NOT NULL,                -- payment_id / refund_id / settlement_id
  entity        TEXT NOT NULL,                -- payment | refund | settlement
  event         TEXT NOT NULL,                -- payment.captured etc.
  amount        NUMERIC(14, 2) DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'received',
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (razorpay_id, event)
);

CREATE TABLE IF NOT EXISTS razorpay_refunds (
  id            TEXT PRIMARY KEY,             -- rfn_...
  payment_id    TEXT NOT NULL,
  order_local_id TEXT,
  amount        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'processed',
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rp_refunds_payment ON razorpay_refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_rp_orders_oid ON razorpay_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_rp_events_created ON razorpay_events(created_at DESC);