-- 機械設備分類マスター
CREATE TABLE IF NOT EXISTS machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_group_code TEXT NOT NULL,
  category_code INTEGER NOT NULL,
  category_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_group_code, category_code)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_machines_work_group_code ON machines(work_group_code);
CREATE INDEX IF NOT EXISTS idx_machines_category_code ON machines(category_code);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE machines DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE machines IS '機械設備分類マスター';
COMMENT ON COLUMN machines.work_group_code IS '作業グループコード';
COMMENT ON COLUMN machines.category_code IS 'カテゴリコード（番号）';
COMMENT ON COLUMN machines.category_name IS 'カテゴリ名';
