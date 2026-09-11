-- 作業日報明細に、L指令の当日完成個数（任意）を追加する
ALTER TABLE work_report_items
ADD COLUMN IF NOT EXISTS completed_qty INTEGER;

ALTER TABLE work_report_items
DROP CONSTRAINT IF EXISTS work_report_items_completed_qty_check;

ALTER TABLE work_report_items
ADD CONSTRAINT work_report_items_completed_qty_check
CHECK (completed_qty IS NULL OR completed_qty >= 0);

COMMENT ON COLUMN work_report_items.completed_qty IS '当日の完成個数（L指令のみ・任意。完成工程のときだけ入力）';
