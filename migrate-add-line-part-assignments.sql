-- Migration: create line_part_assignments table for multiple part_key mapping with ratio

CREATE TABLE IF NOT EXISTS line_part_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  ratio numeric(5,2) NOT NULL DEFAULT 100,  -- パーセンテージ（0-100）
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(line_id, part_key)
);

CREATE INDEX IF NOT EXISTS idx_line_part_assignments_line_id ON line_part_assignments(line_id);
CREATE INDEX IF NOT EXISTS idx_line_part_assignments_part_key ON line_part_assignments(part_key);

-- Grant permissions for anon and authenticated users if using RLS
ALTER TABLE line_part_assignments ENABLE ROW LEVEL SECURITY;

-- Remove part_key column from lines table if it was added
-- ALTER TABLE lines DROP COLUMN IF EXISTS part_key;
-- (Optional: keep it for backward compatibility or remove - your choice)
