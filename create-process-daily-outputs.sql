-- 工程管理: 日次完成品（新規作成用）
-- 既にテーブルがある場合は migrate-process-management-daily.sql を実行してください

CREATE TABLE IF NOT EXISTS process_daily_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('line', 'instruction')),
  target_code TEXT NOT NULL,
  completed_qty INTEGER NOT NULL CHECK (completed_qty >= 0),
  receipt_slip_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_date, target_type, target_code)
);

CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_target
  ON process_daily_outputs(target_type, target_code);
CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_work_date
  ON process_daily_outputs(work_date);
CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_target_date
  ON process_daily_outputs(target_type, target_code, work_date DESC);

ALTER TABLE process_daily_outputs DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE process_daily_outputs IS '工程管理: 日次完成品数（ライン・D指令）';
COMMENT ON COLUMN process_daily_outputs.target_type IS 'line=ラインマスタ, instruction=D指令';
COMMENT ON COLUMN process_daily_outputs.target_code IS 'ラインコードまたは指令番号';
