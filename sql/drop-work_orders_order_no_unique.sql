-- Drop unique constraint/index on work_orders.order_no
-- WARNING: Running this will allow duplicate order_no values. Backup DB before running.

-- If a UNIQUE CONSTRAINT exists with the name shown in the error:
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_order_no_key;

-- If there is a unique index instead (index name may differ), drop it as well:
DROP INDEX IF EXISTS work_orders_order_no_key;

-- Optionally recreate a non-unique normal index for performance:
CREATE INDEX IF NOT EXISTS idx_work_orders_order_no ON work_orders(order_no);

-- Verify:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'work_orders';
