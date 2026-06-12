-- 製造計画マスターテーブル
CREATE TABLE IF NOT EXISTS heater_manufacturing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name VARCHAR(255) NOT NULL,
  fiscal_year VARCHAR(10) NOT NULL,
  plan_period VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 製造計画明細テーブル
CREATE TABLE IF NOT EXISTS heater_manufacturing_plan_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES heater_manufacturing_plans(id) ON DELETE CASCADE,
  model VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_id, model)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_manufacturing_plans_fiscal_year ON heater_manufacturing_plans(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_manufacturing_plan_details_plan_id ON heater_manufacturing_plan_details(plan_id);

-- RLS無効化
ALTER TABLE heater_manufacturing_plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE heater_manufacturing_plan_details DISABLE ROW LEVEL SECURITY;

-- テーブルコメント
COMMENT ON TABLE heater_manufacturing_plans IS '暖房機の製造計画マスター';
COMMENT ON TABLE heater_manufacturing_plan_details IS '製造計画の機種別台数明細';
