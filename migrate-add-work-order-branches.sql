-- ============================================================
-- Migration: 指令原価モード（直接/BOM集計）と枝番テーブル追加
-- ============================================================
-- 目的:
--   現状の直接原価入力方式に加え、BOM部品ごとのライン原価を
--   積み上げて指令原価を集計する「BOM集計モード」を追加する。
--   各BOM部品は「枝番」として work_order_branches に格納し、
--   親指令の合計原価 = 全枝番の subtotal の合算 となる。
-- ============================================================

-- 1) work_orders: コストモードとBOMモデル
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS cost_mode text NOT NULL DEFAULT 'direct'
    CHECK (cost_mode IN ('direct', 'bom')),
  ADD COLUMN IF NOT EXISTS bom_model text;  -- BOM集計時に参照するモデル（heater_bom.model）

-- 2) 枝番テーブル: 指令とBOM部品の対応・原価スナップショット
CREATE TABLE IF NOT EXISTS work_order_branches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  branch_no         text NOT NULL,              -- 'B01', 'B02' など
  part_key          text NOT NULL,              -- heater_parts_master.part_key
  part_name         text,
  product_code      text,                       -- heater_parts_master.product_code
  bom_quantity      numeric(18,4) NOT NULL DEFAULT 1,
  unit_cost         integer NOT NULL DEFAULT 0, -- heater_parts_master.cost_price（同期時スナップショット）
  subtotal          integer NOT NULL DEFAULT 0, -- unit_cost × bom_quantity
  notes             text,
  synced_at         timestamptz,                -- 最後にBOMと同期した日時
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_order_id, branch_no),
  UNIQUE(work_order_id, part_key)              -- 同一指令に同じpart_keyは1件のみ
);

CREATE INDEX IF NOT EXISTS idx_wo_branches_work_order_id
  ON work_order_branches(work_order_id);

CREATE INDEX IF NOT EXISTS idx_wo_branches_part_key
  ON work_order_branches(part_key);

-- 3) work_order_costs テーブルに BOM 集計合計保持用カラムを追加
--    （BOM モード時はここに自動集計結果を保存できる）
ALTER TABLE work_order_costs
  ADD COLUMN IF NOT EXISTS cost_mode text DEFAULT 'direct'
    CHECK (cost_mode IN ('direct', 'bom')),
  ADD COLUMN IF NOT EXISTS branch_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_bom_sync timestamptz;

-- ============================================================
-- 使い方メモ:
--   直接モード (cost_mode = 'direct'):
--     work_order_costs + work_order_cost_items に従来通り入力
--
--   BOM集計モード (cost_mode = 'bom'):
--     1. work_orders.bom_model を指定（例: 'DR8-008'）
--     2. /api/work-orders/branches/sync を呼び出すと
--        heater_bom × heater_parts_master から枝番を自動生成
--     3. work_order_branches に枝番行が作成され
--        subtotal = unit_cost × bom_quantity が設定される
--     4. 合計は GET /api/work-orders/[id]/bom-cost で取得可能
-- ============================================================
