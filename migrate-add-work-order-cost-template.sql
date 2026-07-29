-- D指令: 製品別原価テンプレート（同じ製品の原価を繰り返し計算しない）

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS is_cost_template boolean NOT NULL DEFAULT false;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS cost_template_work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_is_cost_template
  ON work_orders (is_cost_template)
  WHERE is_cost_template = true;

CREATE INDEX IF NOT EXISTS idx_work_orders_cost_template_ref
  ON work_orders (cost_template_work_order_id)
  WHERE cost_template_work_order_id IS NOT NULL;

COMMENT ON COLUMN work_orders.is_cost_template IS 'true=このD指令を同製品の原価テンプレート（標準内訳）として使う';
COMMENT ON COLUMN work_orders.cost_template_work_order_id IS '制作D指令が参照する原価テンプレート指令の work_orders.id';
