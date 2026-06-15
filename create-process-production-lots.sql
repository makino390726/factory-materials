-- 工程管理: 製作ロット（製作開始〜完成入庫）
-- 期間内の作業グループ実績 ÷ 完成台数 = 1台あたりST

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

COMMENT ON TABLE process_production_lots IS '工程管理: 製作ロット（開始日〜完成日・入庫台数）';
COMMENT ON COLUMN process_production_lots.period_start IS '製作開始日';
COMMENT ON COLUMN process_production_lots.period_end IS '完成日（入庫日）';
COMMENT ON COLUMN process_production_lots.completed_qty IS '完成台数';
