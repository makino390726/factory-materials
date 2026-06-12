-- work_order_costs: 指令別の原価ヘッダ
CREATE TABLE IF NOT EXISTS work_order_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid REFERENCES work_orders(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  total_material_cost integer NOT NULL DEFAULT 0,
  total_labor_cost integer NOT NULL DEFAULT 0,
  total_indirect_cost integer NOT NULL DEFAULT 0,
  total_cost integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_costs_order_no ON work_order_costs(order_no);

-- work_order_cost_items: 指令ごとの明細行
CREATE TABLE IF NOT EXISTS work_order_cost_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_cost_id uuid NOT NULL REFERENCES work_order_costs(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 0,
  product_code text,
  part_name text,
  spec text,
  quantity numeric(18,6) NOT NULL DEFAULT 0,
  unit_price numeric(18,6) NOT NULL DEFAULT 0,
  material_cost integer NOT NULL DEFAULT 0,
  labor_cost integer NOT NULL DEFAULT 0,
  indirect_cost integer NOT NULL DEFAULT 0,
  line_total integer NOT NULL DEFAULT 0,
  is_manual boolean NOT NULL DEFAULT false,
  cost_type text DEFAULT '加',
  part_key text,
  master_type text,
  master_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_woc_items_by_cost_id ON work_order_cost_items(work_order_cost_id);
CREATE INDEX IF NOT EXISTS idx_woc_items_by_product_code ON work_order_cost_items(product_code);
CREATE INDEX IF NOT EXISTS idx_woc_items_by_master_type_id ON work_order_cost_items(master_type, master_id);
CREATE INDEX IF NOT EXISTS idx_woc_items_by_part_key ON work_order_cost_items(part_key);

-- trigger: update timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_on_work_order_costs ON work_order_costs;
CREATE TRIGGER set_timestamp_on_work_order_costs
  BEFORE UPDATE ON work_order_costs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- 備考:
-- material_cost等はアプリ側で計算して整数(円)で保存する前提です。
-- DB側での最終検証や再計算をしたい場合は、INSERT/UPDATEトリガでROUND(quantity * unit_price)を設定してください。
