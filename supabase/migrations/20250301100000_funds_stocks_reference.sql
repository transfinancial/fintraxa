-- Reference tables for funds and stocks (synced from Fintraxa API).
-- RLS: authenticated users can read and upsert (sync); no user_id (global reference data).

CREATE TABLE IF NOT EXISTS funds (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  fund_name TEXT NOT NULL UNIQUE,
  fund_category TEXT,
  nav NUMERIC(12,4) NOT NULL,
  trustee TEXT,
  offer_price NUMERIC(12,4),
  repurchase_price NUMERIC(12,4),
  date_updated DATE,
  scrape_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stocks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  company_name TEXT,
  current_price NUMERIC(12,4) NOT NULL,
  change_amount NUMERIC(12,4),
  change_pct NUMERIC(8,2),
  volume BIGINT DEFAULT 0,
  open_price NUMERIC(12,4),
  high NUMERIC(12,4),
  low NUMERIC(12,4),
  ldcp NUMERIC(12,4),
  quote_date DATE,
  scrape_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO sync_metadata (key, value) VALUES
  ('funds', '{"last_scrape": null}'::jsonb),
  ('stocks', '{"last_scrape": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_funds_category ON funds(fund_category);
CREATE INDEX IF NOT EXISTS idx_funds_name ON funds(fund_name);
CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol);
CREATE INDEX IF NOT EXISTS idx_stocks_volume ON stocks(volume DESC);

ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read reference data
CREATE POLICY "Authenticated read funds" ON funds FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read stocks" ON stocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read sync_metadata" ON sync_metadata FOR SELECT TO authenticated USING (true);

-- Authenticated can insert/update for sync (no user_id; same data for all)
CREATE POLICY "Authenticated insert funds" ON funds FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update funds" ON funds FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated insert stocks" ON stocks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update stocks" ON stocks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated update sync_metadata" ON sync_metadata FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated insert sync_metadata" ON sync_metadata FOR INSERT TO authenticated WITH CHECK (true);

CREATE TRIGGER update_funds_updated_at BEFORE UPDATE ON funds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_stocks_updated_at BEFORE UPDATE ON stocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
