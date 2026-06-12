-- Migration: add aggregate cost columns to heater_parts_master
-- Run this if columns do not exist yet.

ALTER TABLE heater_parts_master
ADD COLUMN IF NOT EXISTS material_cost_total integer DEFAULT 0;

ALTER TABLE heater_parts_master
ADD COLUMN IF NOT EXISTS indirect_cost_total integer DEFAULT 0;

ALTER TABLE heater_parts_master
ADD COLUMN IF NOT EXISTS total_cost integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_heater_parts_master_cost_totals ON heater_parts_master(material_cost_total, indirect_cost_total, total_cost);
