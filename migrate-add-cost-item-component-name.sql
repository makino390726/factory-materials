-- 原価明細に「構成部品名」（パーツ内の構成要素・備考）を追加
ALTER TABLE work_order_cost_items
  ADD COLUMN IF NOT EXISTS component_name text;

COMMENT ON COLUMN work_order_cost_items.component_name IS
  'パーツ内の構成要素名（例: 制御ボックス本体）。商品コードの前に表示する備考欄';
