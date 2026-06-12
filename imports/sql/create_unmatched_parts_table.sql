-- Creates a simple table to store unmatched parts discovered during imports or runtime matching
CREATE TABLE IF NOT EXISTS unmatched_parts (
  id BIGSERIAL PRIMARY KEY,
  product_code TEXT,
  part_key TEXT,
  description TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Optional index to help lookups by part_key or product_code
CREATE INDEX IF NOT EXISTS idx_unmatched_parts_part_key ON unmatched_parts(part_key);
CREATE INDEX IF NOT EXISTS idx_unmatched_parts_product_code ON unmatched_parts(product_code);
