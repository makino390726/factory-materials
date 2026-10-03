-- 製作指図書の進捗管理
-- Supabase の SQL Editor で、まずこのファイルを実行してください。
-- そのあと data ファイルを番号順に実行すると、Excel の一覧が入ります。
-- 再実行しても Excel 取込行（source = excel）は上書きされ、画面から登録した D指令行は残ります。
--
-- 作業班の shops:
--   assigned = true  … 製造部長が割り当てた班（Excel の黄色）
--   completed = true … その班の作業が完了（Excel のチェック）

CREATE TABLE IF NOT EXISTS work_instruction_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  doc_type text NOT NULL DEFAULT '製作',
  series_no text NOT NULL DEFAULT '',
  fiscal_year integer,
  sort_no integer,
  parent_sort_no integer,
  branch_no text,
  item_no text,
  category text,
  product_name text,
  model text,
  department text,
  assignee text,
  delivery_place text,
  due_on date,
  due_text text,
  wish_text text,
  planned_qty numeric(18,4),
  partial_qty numeric(18,4),
  occurred_on date,
  elapsed_months integer,
  completed_on date,
  serial_no text,
  receipt_posted boolean NOT NULL DEFAULT false,
  comment text,
  received_order_no text,
  shops jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_instruction_progress_excel
  ON work_instruction_progress (doc_type, sort_no)
  WHERE source = 'excel';

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_instruction_progress_work_order
  ON work_instruction_progress (work_order_id)
  WHERE work_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_instruction_progress_doc_year
  ON work_instruction_progress (doc_type, fiscal_year, sort_no);

ALTER TABLE work_instruction_progress DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_instruction_progress IS '製作指図書の進捗。D指令登録で追加し、製造部長が作業班を割り当てる';
COMMENT ON COLUMN work_instruction_progress.shops IS '作業班配列。assigned=割当、completed=完了。codeは製管/K-1/K-2/K-3/A-1/A-2/A-3/P-1';
COMMENT ON COLUMN work_instruction_progress.series_no IS '指図書番号。Excelでは D令7 のような年度の束。システム登録のD指令は指令番号';
COMMENT ON COLUMN work_instruction_progress.partial_qty IS '分納台数。残台数は planned_qty - partial_qty';

-- このファイルは表の作成だけです。
-- 続けて次のファイルを番号順に SQL Editor で実行すると、Excel の一覧が入ります。
--   1. migrate-work-instruction-progress-data-01.sql
--   2. migrate-work-instruction-progress-data-02.sql
--   3. migrate-work-instruction-progress-data-03.sql
--   4. migrate-work-instruction-progress-data-04.sql
--   5. migrate-work-instruction-progress-data-05.sql
--   6. migrate-work-instruction-progress-data-06.sql
--   7. migrate-work-instruction-progress-data-07.sql
