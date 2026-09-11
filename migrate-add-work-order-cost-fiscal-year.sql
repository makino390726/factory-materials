-- 原価ヘッダに会計年度を追加する
-- 27年度 = 2026/09/01〜2027/08/31

ALTER TABLE work_order_costs
ADD COLUMN IF NOT EXISTS fiscal_year INTEGER;

-- D指令に紐づく原価は指令の年度を引き継ぐ
UPDATE work_order_costs AS c
SET fiscal_year = w.fiscal_year
FROM work_orders AS w
WHERE c.work_order_id = w.id
  AND c.fiscal_year IS NULL
  AND w.fiscal_year IS NOT NULL;

-- L指令原価（D指令未紐づけ）の既存データは 2026年度として扱う（現年度への材料費繰越元）
UPDATE work_order_costs
SET fiscal_year = 2026
WHERE fiscal_year IS NULL
  AND work_order_id IS NULL;

-- 残りは作成日の会計年度
UPDATE work_order_costs
SET fiscal_year = CASE
  WHEN EXTRACT(MONTH FROM created_at) >= 9 THEN EXTRACT(YEAR FROM created_at)::int + 1
  ELSE EXTRACT(YEAR FROM created_at)::int
END
WHERE fiscal_year IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_order_costs_fiscal_year
  ON work_order_costs(fiscal_year);

COMMENT ON COLUMN work_order_costs.fiscal_year IS
  '会計年度（4桁。例:2027=27年度。L指令は材料費を前年度から繰越し、工費は当年度日報で更新）';
