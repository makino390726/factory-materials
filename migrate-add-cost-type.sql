-- Migration: add cost_type to work_order_cost_items
-- Run this if cost_type column does not exist yet.

ALTER TABLE work_order_cost_items
ADD COLUMN IF NOT EXISTS cost_type text DEFAULT '加';

CREATE INDEX IF NOT EXISTS idx_woc_items_by_cost_type ON work_order_cost_items(cost_type);

-- Backfill cost_type based on indirect_cost ratio
-- 間接費/(材料費+工賃) が 0.05 に近ければ '直'、0.3 に近ければ '加'
UPDATE work_order_cost_items
SET cost_type = CASE
  WHEN (material_cost + labor_cost) = 0 THEN '加'
  WHEN ABS(indirect_cost::numeric / NULLIF(material_cost + labor_cost, 0) - 0.05) < 0.1 THEN '直'
  ELSE '加'
END
WHERE cost_type IS NULL;
