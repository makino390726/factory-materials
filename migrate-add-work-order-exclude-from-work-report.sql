-- 作業日報の D指令リストから除外するフラグ
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS exclude_from_work_report BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_work_orders_exclude_from_work_report
  ON work_orders (exclude_from_work_report)
  WHERE exclude_from_work_report = true;

COMMENT ON COLUMN work_orders.exclude_from_work_report IS 'true のとき作業日報の D指令選択肢から除外';
