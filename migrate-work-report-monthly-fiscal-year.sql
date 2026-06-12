-- 月別実績テーブル（未作成の場合は新規作成、作成済みの場合は年度カラムを追加）
-- Supabase SQL エディタでこのファイルをまとめて実行してください

CREATE TABLE IF NOT EXISTS work_report_monthly_durations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('line', 'instruction')),
  code TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  fiscal_year INTEGER,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (category, code, year, month)
);

CREATE INDEX IF NOT EXISTS idx_work_report_monthly_durations_lookup
  ON work_report_monthly_durations (category, code, year DESC, month DESC);

ALTER TABLE work_report_monthly_durations DISABLE ROW LEVEL SECURITY;

ALTER TABLE work_report_monthly_durations
ADD COLUMN IF NOT EXISTS fiscal_year INTEGER;

-- 当社年度で既存行を補完（例: 2026年度=2025/9/1〜2026/8/31。年度=終了年）
UPDATE work_report_monthly_durations
SET fiscal_year = CASE
  WHEN month >= 9 THEN year + 1
  ELSE year
END
WHERE fiscal_year IS NULL;

-- 以前の誤った年度定義で入った行があれば再計算（再実行しても安全）
UPDATE work_report_monthly_durations
SET fiscal_year = CASE
  WHEN month >= 9 THEN year + 1
  ELSE year
END;

COMMENT ON TABLE work_report_monthly_durations IS '作業日報から集計した月別実績（暦月単位。例:26年度=2025/9/1〜2026/8/31）';
COMMENT ON COLUMN work_report_monthly_durations.fiscal_year IS '当社年度（4桁。例:2026=26年度。9/1〜翌8/31で終了年表記）';
