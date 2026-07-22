-- 生産スケジュール保存（算出結果の保存・呼び出し）
CREATE TABLE IF NOT EXISTS production_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  minutes_per_day INTEGER NOT NULL DEFAULT 480 CHECK (minutes_per_day > 0),
  fiscal_year INTEGER NOT NULL,
  source_plan_id UUID,
  source_plan_name TEXT,
  lots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_schedules_created_at
  ON production_schedules(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_schedules_start_date
  ON production_schedules(start_date DESC);

ALTER TABLE production_schedules DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE production_schedules IS '生産スケジュール: 算出結果の保存・呼び出し';
COMMENT ON COLUMN production_schedules.schedule_name IS '表示名（日付自動）';
COMMENT ON COLUMN production_schedules.lots_json IS '算出時のロット入力（画面復元用）';
COMMENT ON COLUMN production_schedules.result_json IS '算出結果スナップショット';
