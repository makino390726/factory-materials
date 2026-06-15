-- upsert エラー対策: (work_date, target_type, target_code) のユニーク制約を追加
-- 「ON CONFLICT specification」エラーが出た場合に実行

DELETE FROM process_daily_outputs
WHERE target_type IS NULL OR target_code IS NULL OR btrim(target_code) = '';

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

ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_target_key;
ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_line_code_key;
ALTER TABLE process_daily_outputs DROP CONSTRAINT IF EXISTS process_daily_outputs_work_date_model_key;
DROP INDEX IF EXISTS process_daily_outputs_work_date_target_uidx;

CREATE UNIQUE INDEX process_daily_outputs_work_date_target_uidx
  ON process_daily_outputs (work_date, target_type, target_code);
