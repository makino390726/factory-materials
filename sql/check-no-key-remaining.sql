-- work_order_branches に __NO_KEY__ が残っていないか一括チェック

-- 1) 残件サマリ
select
  wo.order_no,
  count(*) as no_key_count
from public.work_order_branches wb
join public.work_orders wo on wo.id = wb.work_order_id
where wb.part_key like '__NO_KEY__%'
group by wo.order_no
order by wo.order_no;

-- 2) 明細一覧
select
  wb.id,
  wo.order_no,
  wb.branch_no,
  wb.part_key,
  wo.order_no || '-' || lpad(regexp_replace(wb.branch_no, '^[A-Za-z]+', ''), 2, '0') as normalized_part_key,
  wb.updated_at
from public.work_order_branches wb
join public.work_orders wo on wo.id = wb.work_order_id
where wb.part_key like '__NO_KEY__%'
order by wo.order_no, wb.branch_no;

-- 3) 参考: 一括修正SQL（必要時のみコメント解除して実行）
-- begin;
-- update public.work_order_branches wb
-- set part_key = wo.order_no || '-' || lpad(regexp_replace(wb.branch_no, '^[A-Za-z]+', ''), 2, '0')
-- from public.work_orders wo
-- where wo.id = wb.work_order_id
--   and wb.part_key like '__NO_KEY__%';
-- commit;
