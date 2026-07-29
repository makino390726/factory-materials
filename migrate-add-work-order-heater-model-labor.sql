-- D指令: 機種マスタ親紐（任意）＋制作工賃自動計算／入庫リセット
-- 機種なしの場合は従来どおり単独D指令として運用（併用型）

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS heater_model text;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS assembly_labor_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS assembly_labor_cost integer NOT NULL DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS current_period_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS labor_receipt_date date;

CREATE INDEX IF NOT EXISTS idx_work_orders_heater_model
  ON work_orders (heater_model)
  WHERE heater_model IS NOT NULL;

COMMENT ON COLUMN work_orders.heater_model IS '親機種（heater_models.model）。NULL=従来の単独D指令';
COMMENT ON COLUMN work_orders.assembly_labor_minutes IS '制作工賃の時間（1台・分）。工程STから自動計算、入庫時に確定';
COMMENT ON COLUMN work_orders.assembly_labor_cost IS '制作工賃金額（1台）。(分/480)×17810';
COMMENT ON COLUMN work_orders.current_period_minutes IS '入庫後にリセットされる現サイクル累計時間（分）';
COMMENT ON COLUMN work_orders.labor_receipt_date IS '制作工賃を確定した入庫日';
