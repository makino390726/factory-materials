-- 新しいheater_bomテーブル定義
DROP TABLE IF EXISTS heater_bom CASCADE;

CREATE TABLE heater_bom (
  model TEXT NOT NULL,           -- 機種名 (例: 200L-DF)
  part_key TEXT NOT NULL,        -- 部品キー (heater_parts_masterと紐づく)
  part_name TEXT,                -- 部品名 (参考用)
  quantity NUMERIC NOT NULL DEFAULT 1,  -- 数量
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (model, part_key)  -- 機種と部品の組み合わせで一意
);

-- インデックス作成
CREATE INDEX idx_heater_bom_model ON heater_bom(model);
CREATE INDEX idx_heater_bom_part_key ON heater_bom(part_key);

-- コメント追加
COMMENT ON TABLE heater_bom IS 'ヒーター機種別部品表（BOM）';
COMMENT ON COLUMN heater_bom.model IS '機種名';
COMMENT ON COLUMN heater_bom.part_key IS '部品キー（heater_parts_masterと紐づく）';
COMMENT ON COLUMN heater_bom.part_name IS '部品名（参考用）';
COMMENT ON COLUMN heater_bom.quantity IS '1機種あたりの使用数量';
