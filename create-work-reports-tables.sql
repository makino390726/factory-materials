-- ラインマスター
CREATE TABLE IF NOT EXISTS lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_code TEXT NOT NULL,
  name TEXT NOT NULL,
  standard_duration_minutes INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (line_code)
);

-- 作業日報（ヘッダー）
CREATE TABLE IF NOT EXISTS work_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staffs(id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  break_minutes INTEGER NOT NULL DEFAULT 60,
  work_minutes INTEGER,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (staff_id, work_date),
  CHECK (is_draft OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time AND work_minutes > 0)),
  CHECK (break_minutes >= 0),
  CHECK (work_minutes IS NULL OR work_minutes > 0)
);

-- 作業日報（明細）
CREATE TABLE IF NOT EXISTS work_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
  work_type TEXT NOT NULL,
  work_content TEXT NOT NULL,
  instruction_text TEXT,
  line_id UUID REFERENCES lines(id) ON DELETE SET NULL,
  model TEXT,
  machine TEXT,
  notes TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time),
  CHECK (duration_minutes > 0)
);

-- 既存の作業区分チェック制約を削除（印刷種別の値を許可）
ALTER TABLE work_report_items
DROP CONSTRAINT IF EXISTS work_report_items_work_type_check;

-- 応援フィールドを追加（マイグレーション）
ALTER TABLE work_report_items
ADD COLUMN IF NOT EXISTS is_support BOOLEAN NOT NULL DEFAULT false;

-- 作業日報の一時保存フラグを追加（マイグレーション）
ALTER TABLE work_reports
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE work_report_items
ADD COLUMN IF NOT EXISTS support_work_group_code TEXT;

-- linesテーブルに所要時間カラムを追加（マイグレーション）
ALTER TABLE lines
ADD COLUMN IF NOT EXISTS standard_duration_minutes INTEGER NOT NULL DEFAULT 0;

-- 集計結果のマスター反映履歴
CREATE TABLE IF NOT EXISTS work_report_master_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  added_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (from_date, to_date, category, code)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_lines_active_sort ON lines(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_work_reports_staff_date ON work_reports(staff_id, work_date);
CREATE INDEX IF NOT EXISTS idx_work_report_items_report_id ON work_report_items(report_id);
CREATE INDEX IF NOT EXISTS idx_work_report_items_line_id ON work_report_items(line_id);
CREATE INDEX IF NOT EXISTS idx_work_report_items_work_type ON work_report_items(work_type);
CREATE INDEX IF NOT EXISTS idx_work_report_master_updates_range ON work_report_master_updates(from_date, to_date, category);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE work_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE work_report_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE work_report_master_updates DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE lines IS 'ラインマスター';
COMMENT ON COLUMN lines.line_code IS 'ラインコード';
COMMENT ON COLUMN lines.name IS 'ライン名';
COMMENT ON COLUMN lines.standard_duration_minutes IS '標準所要時間（分）';

COMMENT ON TABLE work_report_master_updates IS '集計結果のマスター反映履歴';
COMMENT ON COLUMN work_report_master_updates.from_date IS '集計開始日';
COMMENT ON COLUMN work_report_master_updates.to_date IS '集計終了日';
COMMENT ON COLUMN work_report_master_updates.category IS '集計区分（line/instruction）';
COMMENT ON COLUMN work_report_master_updates.code IS 'コード（ラインコード/指令番号）';
COMMENT ON COLUMN work_report_master_updates.added_minutes IS '前回加算した所要時間（分）';

COMMENT ON TABLE work_reports IS '製造作業日報（ヘッダー）';
COMMENT ON COLUMN work_reports.work_date IS '作業日';
COMMENT ON COLUMN work_reports.start_time IS '出社時間';
COMMENT ON COLUMN work_reports.end_time IS '退社時間';
COMMENT ON COLUMN work_reports.break_minutes IS '休憩時間（分）';
COMMENT ON COLUMN work_reports.work_minutes IS '勤務時間（分）';

COMMENT ON TABLE work_report_items IS '製造作業日報（明細）';
COMMENT ON COLUMN work_report_items.work_type IS '作業区分（印刷種別）';
COMMENT ON COLUMN work_report_items.work_content IS '作業内容';
COMMENT ON COLUMN work_report_items.is_support IS '応援フラグ';
COMMENT ON COLUMN work_report_items.support_work_group_code IS '応援先作業グループコード';
COMMENT ON COLUMN work_report_items.instruction_text IS 'D指令';
COMMENT ON COLUMN work_report_items.line_id IS 'ライン';
COMMENT ON COLUMN work_report_items.model IS '型式';
COMMENT ON COLUMN work_report_items.machine IS '使用機械';
COMMENT ON COLUMN work_report_items.notes IS '備考';
COMMENT ON COLUMN work_report_items.duration_minutes IS '所要時間（分）';

-- 使用機械の明細集計・確定時間（add-work-report-machine-durations.sql と同等）
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
