-- Migration: add part_key to lines table
-- Run this to enable part_key association for lines

ALTER TABLE lines
ADD COLUMN IF NOT EXISTS part_key text;

CREATE INDEX IF NOT EXISTS idx_lines_part_key ON lines(part_key);
