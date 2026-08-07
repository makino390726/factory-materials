-- 機種ごとのパーツ一覧グループ名定義
-- Supabase SQL Editor で実行してください（migrate-add-heater-bom-part-group.sql の後）

CREATE TABLE IF NOT EXISTS heater_bom_groups (
  model TEXT NOT NULL,
  group_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (model, group_name)
);

CREATE INDEX IF NOT EXISTS idx_heater_bom_groups_model_sort
  ON heater_bom_groups (model, sort_order, group_name);

COMMENT ON TABLE heater_bom_groups IS '機種ごとのパーツ一覧グループ名（暖房機・たばこ乾燥機等で名称が異なる）';
