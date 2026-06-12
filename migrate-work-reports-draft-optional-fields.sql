BEGIN;

ALTER TABLE work_reports
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL,
  ALTER COLUMN work_minutes DROP NOT NULL;

DO $$
DECLARE
  check_constraint RECORD;
BEGIN
  FOR check_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'work_reports'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE work_reports DROP CONSTRAINT IF EXISTS %I', check_constraint.conname);
  END LOOP;
END $$;

ALTER TABLE work_reports
  ADD CONSTRAINT work_reports_break_minutes_check CHECK (break_minutes >= 0),
  ADD CONSTRAINT work_reports_work_minutes_check CHECK (work_minutes IS NULL OR work_minutes > 0),
  ADD CONSTRAINT work_reports_draft_time_check CHECK (
    is_draft OR (
      start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
      AND work_minutes > 0
    )
  );

COMMIT;
