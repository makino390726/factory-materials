-- stock_movements テーブルに操作者情報を追加
-- 誰が在庫移動を行ったかを記録できるようにする

-- 古いstaff_idカラムを削除（整数型の古いカラム）
ALTER TABLE stock_movements 
DROP COLUMN IF EXISTS staff_id;

-- login_id カラムを追加（NULL許可: 既存データに対応）
ALTER TABLE stock_movements 
ADD COLUMN IF NOT EXISTS login_id TEXT,
ADD COLUMN IF NOT EXISTS staff_name TEXT;

-- インデックスを追加（検索性能向上）
CREATE INDEX IF NOT EXISTS idx_stock_movements_login_id ON stock_movements(login_id);

-- スタッフマスタとの外部キー制約を追加（スタッフ削除時はNULLに設定）
ALTER TABLE stock_movements
DROP CONSTRAINT IF EXISTS fk_stock_movements_staff;

ALTER TABLE stock_movements
ADD CONSTRAINT fk_stock_movements_staff
FOREIGN KEY (login_id)
REFERENCES staffs(login_id)
ON DELETE SET NULL;

-- コメント追加
COMMENT ON COLUMN stock_movements.login_id IS '操作者のログインID';
COMMENT ON COLUMN stock_movements.staff_name IS '操作者の氏名（記録時点の名前を保持）';

-- 確認用クエリ
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'stock_movements'
ORDER BY ordinal_position;
