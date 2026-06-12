-- 作業指令マスター
CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL,
  product_name TEXT,
  model TEXT,
  work_content TEXT,
  standard_duration_minutes INTEGER NOT NULL DEFAULT 0,
  qty INTEGER,
  status TEXT DEFAULT '未開始',
  completed BOOLEAN DEFAULT false,
  completed_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IS NULL OR status IN ('未開始', '進行中', '完了', '保留', 'その他'))
);

-- 既存テーブルへのカラム追加（テーブル既存時）
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS completed_date TIMESTAMPTZ;

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS product_name TEXT;

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS work_content TEXT;

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS standard_duration_minutes INTEGER NOT NULL DEFAULT 0;

-- 既存のNOT NULL制約を削除（nullableに変更）
ALTER TABLE work_orders
ALTER COLUMN status DROP NOT NULL;

ALTER TABLE work_orders
ALTER COLUMN completed DROP NOT NULL;

-- work_report_items に order_id カラムを追加するマイグレーション
ALTER TABLE work_report_items
ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_completed ON work_orders(completed);
CREATE INDEX IF NOT EXISTS idx_work_orders_order_no ON work_orders(order_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_order_no_model_unique
  ON work_orders (order_no, COALESCE(model, ''));
CREATE INDEX IF NOT EXISTS idx_work_report_items_order_id ON work_report_items(order_id);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE work_orders DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_orders IS '作業指令マスター';
COMMENT ON COLUMN work_orders.order_no IS '作業指令番号';
COMMENT ON COLUMN work_orders.product_name IS '製品名';
COMMENT ON COLUMN work_orders.model IS '型式';
COMMENT ON COLUMN work_orders.work_content IS '作業内容';
COMMENT ON COLUMN work_orders.standard_duration_minutes IS '標準所要時間（分）';
COMMENT ON COLUMN work_orders.qty IS '数量';
COMMENT ON COLUMN work_orders.status IS 'ステータス（未開始/進行中/完了など）';
COMMENT ON COLUMN work_orders.completed IS '完了フラグ';
COMMENT ON COLUMN work_orders.completed_date IS '完了日時';
