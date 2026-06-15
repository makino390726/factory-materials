-- 工程管理: model 列 → line_code 列へ移行（既存テーブル用）
-- 新規作成は create-process-management-tables.sql を使用

-- テーブルが無い場合は新規作成
CREATE TABLE IF NOT EXISTS process_monthly_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  line_code TEXT NOT NULL,
  completed_qty INTEGER NOT NULL CHECK (completed_qty >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (year, month, line_code)
);

-- 旧スキーマ（model列）からの移行
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'process_monthly_outputs'
      AND column_name = 'model'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'process_monthly_outputs'
      AND column_name = 'line_code'
  ) THEN
    ALTER TABLE process_monthly_outputs RENAME COLUMN model TO line_code;
  END IF;
END $$;

ALTER TABLE process_monthly_outputs DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS idx_process_monthly_outputs_model;
CREATE INDEX IF NOT EXISTS idx_process_monthly_outputs_line_code
  ON process_monthly_outputs(line_code);
CREATE INDEX IF NOT EXISTS idx_process_monthly_outputs_year_month
  ON process_monthly_outputs(year, month);

COMMENT ON TABLE process_monthly_outputs IS '工程管理: ライン別月次完成品数（902〜909）';
COMMENT ON COLUMN process_monthly_outputs.line_code IS 'ラインコード（例: 902）';
COMMENT ON COLUMN process_monthly_outputs.completed_qty IS '完成台数';
