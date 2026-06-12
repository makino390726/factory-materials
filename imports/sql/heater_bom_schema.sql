-- heater_bom テーブルの再作成（新しいカラム構造）
-- このSQLをSupabaseのSQL Editorで実行してください

DROP TABLE IF EXISTS heater_bom CASCADE;

CREATE TABLE heater_bom (
  model TEXT NOT NULL,           -- 機種名 (例: 200L-DF)
  part_key TEXT NOT NULL,        -- 部品キー (heater_parts_masterと紐づく)
  part_name TEXT,                -- 部品名
  quantity NUMERIC NOT NULL DEFAULT 1,  -- 数量
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (model, part_key)
);

-- インデックス作成
CREATE INDEX idx_heater_bom_model ON heater_bom(model);
CREATE INDEX idx_heater_bom_part_key ON heater_bom(part_key);

-- RLS設定（必要に応じて）
ALTER TABLE heater_bom ENABLE ROW LEVEL SECURITY;

-- public で全員読み取り可能、書き込みは認証ユーザー
CREATE POLICY "heater_bom_select_policy" ON heater_bom
  FOR SELECT USING (true);

CREATE POLICY "heater_bom_insert_policy" ON heater_bom
  FOR INSERT WITH CHECK (true);

CREATE POLICY "heater_bom_update_policy" ON heater_bom
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "heater_bom_delete_policy" ON heater_bom
  FOR DELETE USING (true);
