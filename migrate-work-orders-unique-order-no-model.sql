-- 旧仕様: order_no 単体ユニーク
-- 新仕様: order_no + model(code_type) の複合ユニーク
--
-- 重要:
-- 既存データに (order_no, model) 重複があるとユニークインデックス作成に失敗するため、
-- 同一キーの古い行を整理してからインデックスを作成する。

BEGIN;

ALTER TABLE work_orders
DROP CONSTRAINT IF EXISTS work_orders_order_no_key;

-- 監査用バックアップ（既にあれば再作成しない）
CREATE TABLE IF NOT EXISTS work_orders_duplicate_backup (
  archived_at timestamptz NOT NULL DEFAULT now(),
  id uuid NOT NULL,
  order_no text NOT NULL,
  product_name text,
  model text,
  work_content text,
  standard_duration_minutes integer,
  qty integer,
  status text,
  completed boolean,
  completed_date timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

-- 同一 (order_no, model) で最新1件を残し、それ以外をバックアップへ退避
WITH ranked AS (
  SELECT
    w.*,
    ROW_NUMBER() OVER (
      PARTITION BY w.order_no, COALESCE(w.model, '')
      ORDER BY COALESCE(w.updated_at, w.created_at) DESC, w.id DESC
    ) AS rn
  FROM work_orders w
), dups AS (
  SELECT *
  FROM ranked
  WHERE rn > 1
)
INSERT INTO work_orders_duplicate_backup (
  id,
  order_no,
  product_name,
  model,
  work_content,
  standard_duration_minutes,
  qty,
  status,
  completed,
  completed_date,
  created_at,
  updated_at
)
SELECT
  d.id,
  d.order_no,
  d.product_name,
  d.model,
  d.work_content,
  d.standard_duration_minutes,
  d.qty,
  d.status,
  d.completed,
  d.completed_date,
  d.created_at,
  d.updated_at
FROM dups d;

DELETE FROM work_orders w
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY order_no, COALESCE(model, '')
        ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      ) AS rn
    FROM work_orders
  ) t
  WHERE t.rn > 1
) dd
WHERE w.id = dd.id;

-- model が NULL の場合も同一キーとして扱う
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_order_no_model_unique
  ON work_orders (order_no, COALESCE(model, ''));

COMMIT;
