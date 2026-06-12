-- Migration: Add master_type, master_id, cost_type, part_key to work_order_cost_items
-- This script adds missing columns to support the new cost tracking structure

-- Add cost_type column if not exists
ALTER TABLE work_order_cost_items
ADD COLUMN IF NOT EXISTS cost_type text DEFAULT '加';

-- Add part_key column if not exists
ALTER TABLE work_order_cost_items
ADD COLUMN IF NOT EXISTS part_key text;

-- Add master_type column if not exists
ALTER TABLE work_order_cost_items
ADD COLUMN IF NOT EXISTS master_type text;

-- Add master_id column if not exists
ALTER TABLE work_order_cost_items
ADD COLUMN IF NOT EXISTS master_id text;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_woc_items_by_master_type_id ON work_order_cost_items(master_type, master_id);
CREATE INDEX IF NOT EXISTS idx_woc_items_by_part_key ON work_order_cost_items(part_key);

-- Backfill legacy data: Set master_type='ライン原価' and master_id=part_key for items with part_key
UPDATE work_order_cost_items
SET master_type = 'ライン原価', master_id = part_key
WHERE part_key IS NOT NULL AND master_type IS NULL;

-- Backfill legacy data: Set master_type='指令原価' for items with work_order_cost_id (指令)
UPDATE work_order_cost_items
SET master_type = '指令原価', master_id = (
  SELECT order_no FROM work_order_costs WHERE work_order_costs.id = work_order_cost_items.work_order_cost_id
)
WHERE master_type IS NULL;
