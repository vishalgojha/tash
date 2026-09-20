-- WhatsApp CRM + conversation memory (port of the legacy agent's Supabase schema)
CREATE TABLE IF NOT EXISTS wa_contacts (
  id              BIGSERIAL PRIMARY KEY,
  phone           TEXT UNIQUE NOT NULL,
  name            TEXT,
  persona         TEXT, -- D2C_CUSTOMER | MARKETPLACE_REDIRECT | WHOLESALE_BUYER | INFLUENCER_COLLAB | UNKNOWN
  platform_source TEXT,
  business_name   TEXT,
  instagram_handle TEXT,
  follower_count  INTEGER,
  email           TEXT,
  is_qualified    BOOLEAN NOT NULL DEFAULT false,
  needs_handoff   BOOLEAN NOT NULL DEFAULT false,
  handoff_reason  TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_conversations (
  id          BIGSERIAL PRIMARY KEY,
  contact_id  BIGINT REFERENCES wa_contacts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  skill_used  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_contact ON wa_conversations(contact_id, created_at DESC);