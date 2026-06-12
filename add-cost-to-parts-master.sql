-- パーツマスターに原価カラムを追加
ALTER TABLE heater_parts_master 
ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2) DEFAULT 0;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_parts_master_cost_price ON heater_parts_master(cost_price);

COMMENT ON COLUMN heater_parts_master.cost_price IS '部品の原価単価';
