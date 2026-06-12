-- スタッフマスターテーブル
CREATE TABLE IF NOT EXISTS staffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  work_group_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (login_id)
);

-- 既存テーブルへのカラム追加（テーブル既存時）
ALTER TABLE staffs
ADD COLUMN IF NOT EXISTS work_group_code TEXT;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_staffs_department ON staffs(department);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE staffs DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE staffs IS 'スタッフマスター';
COMMENT ON COLUMN staffs.login_id IS 'ログインID';
COMMENT ON COLUMN staffs.name IS '氏名';
COMMENT ON COLUMN staffs.department IS '部署/作業班';
COMMENT ON COLUMN staffs.work_group_code IS '作業グループコード';
