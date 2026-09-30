-- 日報のL指令行に、構成パーツごとの当日制作数を持たせる
-- 所要時間はL指令のまま。パーツごとの作業時間は持たない。

CREATE TABLE IF NOT EXISTS work_report_part_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_item_id uuid NOT NULL REFERENCES work_report_items(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  produced_qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_item_id, part_key),
  CHECK (produced_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_work_report_part_outputs_line
  ON work_report_part_outputs(line_id, part_key);

CREATE INDEX IF NOT EXISTS idx_work_report_part_outputs_item
  ON work_report_part_outputs(report_item_id);

ALTER TABLE work_report_part_outputs DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_report_part_outputs IS '日報明細ごとのL指令構成パーツ制作数（作業時間は含まない）';
COMMENT ON COLUMN work_report_part_outputs.produced_qty IS 'その明細で作ったパーツ数';
