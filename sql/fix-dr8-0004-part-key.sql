-- DR8-0004 の枝番で __NO_KEY__ が入っている part_key を正規化する
-- 例: B01 -> DR8-0004-01

-- 事前確認
select
  wb.id,
  wo.order_no,
  wb.branch_no,
  wb.part_key,
  wo.order_no || '-' || lpad(regexp_replace(wb.branch_no, '^[A-Za-z]+', ''), 2, '0') as normalized_part_key
from public.work_order_branches wb
join public.work_orders wo on wo.id = wb.work_order_id
where wo.order_no = 'DR8-0004'
  and wb.part_key like '__NO_KEY__%'
order by wb.branch_no;

begin;

update public.work_order_branches wb
set part_key = wo.order_no || '-' || lpad(regexp_replace(wb.branch_no, '^[A-Za-z]+', ''), 2, '0')
from public.work_orders wo
where wo.id = wb.work_order_id
  and wo.order_no = 'DR8-0004'
  and wb.part_key like '__NO_KEY__%';

-- 更新結果確認
select
  wb.id,
  wo.order_no,
  wb.branch_no,
  wb.part_key
from public.work_order_branches wb
join public.work_orders wo on wo.id = wb.work_order_id
where wo.order_no = 'DR8-0004'
order by wb.branch_no;

commit;
