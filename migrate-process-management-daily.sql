-- 工程管理: process_daily_outputs を最新形式へ移行
-- 旧形式（model / line_code のみ）から target_type + target_code へ統一
-- Supabase SQL Editor でこのファイルを丸ごと実行してください

CREATE TABLE IF NOT EXISTS process_daily_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  completed_qty INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
  receipt_slip_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 旧列があれば新列へコピー
ALTER TABLE process_daily_outputs ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE process_daily_outputs ADD COLUMN IF NOT EXISTS target_code TEXT;
ALTER TABLE process_daily_outputs ADD COLUMN IF NOT EXISTS line_code TEXT;
ALTER TABLE process_daily_outputs ADD COLUMN IF NOT EXISTS model TEXT;

UPDATE process_daily_outputs
SET target_type = 'line', target_code = line_code
WHERE target_type IS NULL AND line_code IS NOT NULL AND btrim(line_code) <> '';

UPDATE process_daily_outputs
SET target_type = 'line', target_code = model
WHERE target_type IS NULL AND model IS NOT NULL AND btrim(model) <> '';

-- 旧ユニーク制約を削除
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'process_daily_outputs'
      AND c.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE process_daily_outputs DROP COLUMN IF EXISTS line_code;
ALTER TABLE process_daily_outputs DROP COLUMN IF EXISTS model;

DELETE FROM process_daily_outputs
WHERE target_type IS NULL OR target_code IS NULL OR btrim(target_code) = '';

-- 同一日・同一対象の重複行を削除（最新 updated_at を残す）
DELETE FROM process_daily_outputs a
USING process_daily_outputs b
WHERE a.work_date = b.work_date
  AND a.target_type = b.target_type
  AND a.target_code = b.target_code
  AND (
    COALESCE(a.updated_at, a.created_at, '1970-01-01'::timestamptz)
    < COALESCE(b.updated_at, b.created_at, '1970-01-01'::timestamptz)
    OR (
      COALESCE(a.updated_at, a.created_at, '1970-01-01'::timestamptz)
      = COALESCE(b.updated_at, b.created_at, '1970-01-01'::timestamptz)
      AND a.id::text > b.id::text
    )
  );

ALTER TABLE process_daily_outputs
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_code SET NOT NULL;

ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_target_type_check;
ALTER TABLE process_daily_outputs
  ADD CONSTRAINT process_daily_outputs_target_type_check
  CHECK (target_type IN ('line', 'instruction'));

-- upsert 用ユニーク制約（アプリの onConflict と一致させる）
ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_target_key;
ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_line_code_key;
ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_model_key;
CREATE UNIQUE INDEX IF NOT EXISTS process_daily_outputs_work_date_target_uidx
  ON process_daily_outputs (work_date, target_type, target_code);

ALTER TABLE process_daily_outputs DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS idx_process_daily_outputs_line_code;
DROP INDEX IF EXISTS idx_process_daily_outputs_model;
CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_target
  ON process_daily_outputs(target_type, target_code);
CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_work_date
  ON process_daily_outputs(work_date);
CREATE INDEX IF NOT EXISTS idx_process_daily_outputs_target_date
  ON process_daily_outputs(target_type, target_code, work_date DESC);

COMMENT ON TABLE process_daily_outputs IS '工程管理: 日次完成品数（ライン・D指令）';
COMMENT ON COLUMN process_daily_outputs.target_type IS 'line=ラインマスタ, instruction=D指令';
COMMENT ON COLUMN process_daily_outputs.target_code IS 'ラインコードまたは指令番号';
COMMENT ON COLUMN process_daily_outputs.work_date IS '完成日（入庫日）';
COMMENT ON COLUMN process_daily_outputs.receipt_slip_no IS '入庫伝票番号';

-- 製作ロット（期間ベース ST 算出）※ create-process-production-lots.sql と同一
CREATE TABLE IF NOT EXISTS process_production_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('line', 'instruction')),
  target_code TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  completed_qty INTEGER NOT NULL CHECK (completed_qty > 0),
  receipt_slip_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_process_production_lots_target
  ON process_production_lots(target_type, target_code, period_end DESC);
ALTER TABLE process_production_lots DISABLE ROW LEVEL SECURITY;
