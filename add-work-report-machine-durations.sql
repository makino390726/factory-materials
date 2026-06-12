-- 日報ごとの使用機械時間（明細集計と確定値）
CREATE TABLE IF NOT EXISTS work_report_machine_durations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
  machine TEXT NOT NULL,
  computed_duration_minutes INTEGER NOT NULL,
  confirmed_duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (report_id, machine),
  CHECK (computed_duration_minutes >= 0),
  CHECK (confirmed_duration_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_work_report_machine_durations_report_id
  ON work_report_machine_durations(report_id);

ALTER TABLE work_report_machine_durations DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_report_machine_durations IS '作業日報の使用機械別時間（明細からの集計値と確定値）';
COMMENT ON COLUMN work_report_machine_durations.computed_duration_minutes IS '明細行から集計した分（保存時スナップショット）';
COMMENT ON COLUMN work_report_machine_durations.confirmed_duration_minutes IS 'ユーザー確定後の機械稼働時間（分）';
