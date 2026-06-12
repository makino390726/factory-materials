-- stocks テーブルにカラムを追加
-- 在庫単価、在庫金額のカラムを追加します

ALTER TABLE stocks 
ADD COLUMN IF NOT EXISTS unit_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS shelf_no TEXT;

-- product_code にユニーク制約を追加（重複防止）
ALTER TABLE stocks 
ADD CONSTRAINT stocks_product_code_key UNIQUE (product_code);

-- products とのリレーションを再構築（外部キーの再作成）
-- 既存制約があれば削除
ALTER TABLE stocks
DROP CONSTRAINT IF EXISTS stocks_product_code_fkey;

-- products.product_code への外部キーを追加
ALTER TABLE stocks
ADD CONSTRAINT stocks_product_code_fkey
FOREIGN KEY (product_code)
REFERENCES products (product_code)
ON UPDATE CASCADE
ON DELETE RESTRICT;

-- 在庫 + 製品名のビューを作成（stocks 件数のまま name を付与）
CREATE OR REPLACE VIEW stocks_with_name AS
SELECT
	s.product_code,
	COALESCE(p.name, '(未登録)') AS name,
	s.stock_qty,
	s.unit_price,
	s.total_amount,
	s.updated_at
FROM stocks s
LEFT JOIN products p ON p.product_code = s.product_code;

-- 確認
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'stocks';

-- 棚番カラムの追加だけを実行したい場合（単体SQL）
-- ALTER TABLE stocks ADD COLUMN IF NOT EXISTS shelf_no TEXT;
