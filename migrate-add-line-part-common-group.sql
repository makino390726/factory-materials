-- ラインパーツ割り当てに共通明細・労賃按分設定を追加

ALTER TABLE line_part_assignments
  ADD COLUMN IF NOT EXISTS common_group_label TEXT,
  ADD COLUMN IF NOT EXISTS allocation_models JSONB,
  ADD COLUMN IF NOT EXISTS bom_model_count INTEGER,
  ADD COLUMN IF NOT EXISTS common_group_source TEXT NOT NULL DEFAULT 'bom_auto',
  ADD COLUMN IF NOT EXISTS settings_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settings_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labor_recalc_at TIMESTAMPTZ;

COMMENT ON COLUMN line_part_assignments.common_group_label IS '共通明細表示（例: 全機種、500・600系共通）';
COMMENT ON COLUMN line_part_assignments.allocation_models IS '労賃按分対象機種（JSON配列）。NULLならBOM登録機種を使用';
COMMENT ON COLUMN line_part_assignments.bom_model_count IS 'BOM登録機種数（参考）';
COMMENT ON COLUMN line_part_assignments.common_group_source IS 'bom_auto | manual';
COMMENT ON COLUMN line_part_assignments.settings_confirmed IS '按分設定の確認済みフラグ';
COMMENT ON COLUMN line_part_assignments.settings_confirmed_at IS '按分設定の確認日時';
COMMENT ON COLUMN line_part_assignments.labor_recalc_at IS '最終労賃再計算日時';
