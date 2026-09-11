-- D指令・機種指令を会計年度（9/1〜翌8/31、終了年表記）で管理する
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS fiscal_year INTEGER;

UPDATE work_orders
SET fiscal_year = CASE
  WHEN EXTRACT(MONTH FROM created_at) >= 9 THEN EXTRACT(YEAR FROM created_at)::integer + 1
  ELSE EXTRACT(YEAR FROM created_at)::integer
END
WHERE fiscal_year IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_fiscal_year ON work_orders(fiscal_year);

COMMENT ON COLUMN work_orders.fiscal_year IS '会計年度（4桁。例:2027=27年度。2026/9/1〜2027/8/31）';
