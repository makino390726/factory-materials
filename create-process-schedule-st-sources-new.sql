-- テーブルがまだ無い場合のみ実行（通常は不要）
CREATE TABLE process_schedule_st_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('line', 'instruction')),
  target_code text NOT NULL,
  model text NOT NULL,
  fiscal_year integer NOT NULL,
  spec_key text NOT NULL DEFAULT '',
  apply_to_schedule boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_code, model)
);

CREATE INDEX IF NOT EXISTS idx_process_schedule_st_sources_target
  ON process_schedule_st_sources (target_type, target_code);

CREATE INDEX IF NOT EXISTS idx_process_schedule_st_sources_model
  ON process_schedule_st_sources (model);
