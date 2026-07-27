-- process_schedule_st_sources に model 列を追加する移行SQL
-- ※テーブルは既にある前提。Supabase SQL Editor でこの内容だけを実行してください。

ALTER TABLE process_schedule_st_sources
  ADD COLUMN IF NOT EXISTS model text;

UPDATE process_schedule_st_sources
SET model = target_code
WHERE model IS NULL OR btrim(model) = '';

ALTER TABLE process_schedule_st_sources
  ALTER COLUMN model SET NOT NULL;

ALTER TABLE process_schedule_st_sources
  DROP CONSTRAINT IF EXISTS process_schedule_st_sources_target_type_target_code_key;

ALTER TABLE process_schedule_st_sources
  DROP CONSTRAINT IF EXISTS process_schedule_st_sources_target_type_target_code_model_key;

ALTER TABLE process_schedule_st_sources
  ADD CONSTRAINT process_schedule_st_sources_target_type_target_code_model_key
  UNIQUE (target_type, target_code, model);

CREATE INDEX IF NOT EXISTS idx_process_schedule_st_sources_target
  ON process_schedule_st_sources (target_type, target_code);

CREATE INDEX IF NOT EXISTS idx_process_schedule_st_sources_model
  ON process_schedule_st_sources (model);
