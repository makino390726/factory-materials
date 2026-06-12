-- 作業グループマスター
CREATE TABLE IF NOT EXISTS work_group_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_no TEXT NOT NULL,
  work_group_code TEXT NOT NULL UNIQUE,
  work_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_work_group_master_work_group_code ON work_group_master(work_group_code);
CREATE INDEX IF NOT EXISTS idx_work_group_master_group_no ON work_group_master(group_no);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE work_group_master DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_group_master IS '作業グループマスター';
COMMENT ON COLUMN work_group_master.group_no IS 'グループ番号';
COMMENT ON COLUMN work_group_master.work_group_code IS '作業グループコード';
COMMENT ON COLUMN work_group_master.work_name IS '作業名';
