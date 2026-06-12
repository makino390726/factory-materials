-- 作業内容マスター
CREATE TABLE IF NOT EXISTS work_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_group_code TEXT NOT NULL,
  work_code TEXT NOT NULL,
  work_name TEXT NOT NULL,
  print_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_group_code, work_code)
);

-- 既存テーブルのカラム名変更（rrint_type -> print_type）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'work_contents'
      AND column_name = 'rrint_type'
  ) THEN
    ALTER TABLE work_contents RENAME COLUMN rrint_type TO print_type;
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_work_contents_work_group_code ON work_contents(work_group_code);
CREATE INDEX IF NOT EXISTS idx_work_contents_work_code ON work_contents(work_code);

-- RLS無効化（認証なしでアクセス可能にする）
ALTER TABLE work_contents DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_contents IS '作業内容マスター';
COMMENT ON COLUMN work_contents.work_group_code IS '作業グループコード';
COMMENT ON COLUMN work_contents.work_code IS '作業コード';
COMMENT ON COLUMN work_contents.work_name IS '作業名';
COMMENT ON COLUMN work_contents.print_type IS '印刷種別';
