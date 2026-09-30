-- L指令の構成パーツをD指令の枝番と同じ項目で登録する

ALTER TABLE line_part_assignments
  ADD COLUMN IF NOT EXISTS branch_no text,
  ADD COLUMN IF NOT EXISTS part_name text,
  ADD COLUMN IF NOT EXISTS product_code text,
  ADD COLUMN IF NOT EXISTS bom_quantity numeric(18,4) NOT NULL DEFAULT 1;

COMMENT ON COLUMN line_part_assignments.branch_no IS '構成パーツ枝番（B01 など）。工費行は持たない';
COMMENT ON COLUMN line_part_assignments.part_name IS '構成パーツ名';
COMMENT ON COLUMN line_part_assignments.bom_quantity IS '指令1台あたりの構成数量';

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY line_id ORDER BY created_at, part_key) AS n
  FROM line_part_assignments
  WHERE branch_no IS NULL OR btrim(branch_no) = ''
)
UPDATE line_part_assignments AS assignment
SET branch_no = 'B' || lpad(numbered.n::text, 2, '0')
FROM numbered
WHERE assignment.id = numbered.id;
