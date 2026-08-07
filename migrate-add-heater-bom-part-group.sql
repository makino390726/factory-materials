-- 機種パーツ一覧のグループ表示用
-- Supabase SQL Editor で実行してください

ALTER TABLE heater_bom
  ADD COLUMN IF NOT EXISTS part_group TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_heater_bom_model_group_sort
  ON heater_bom (model, part_group, sort_order, part_key);

COMMENT ON COLUMN heater_bom.part_group IS 'パーツ一覧グループ名（heater_bom_groups と連動・機種ごとに異なる）';
COMMENT ON COLUMN heater_bom.sort_order IS 'グループ内の表示順';
