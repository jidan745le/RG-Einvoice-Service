-- 多租户发票同步功能数据库索引优化
-- 执行时间: 2024-12-20

-- 1. 提高同步时间查询性能的复合索引
-- 用于快速查询特定租户的最新发票创建时间
CREATE INDEX IF NOT EXISTS idx_invoice_tenant_created 
ON invoices(epicor_tenant_company, created_at DESC);

-- 2. 提高重复检查性能的复合索引
-- 用于快速检查发票是否已存在（基于租户和ERP发票ID）
CREATE INDEX IF NOT EXISTS idx_invoice_tenant_erp_id 
ON invoices(epicor_tenant_company, erp_invoice_id);

-- 3. 提高状态统计查询性能
-- 用于快速统计各状态的发票数量
CREATE INDEX IF NOT EXISTS idx_invoice_status 
ON invoices(status);

-- 4. 提高租户分布统计性能
-- 用于快速统计各租户的发票数量
CREATE INDEX IF NOT EXISTS idx_invoice_tenant_company 
ON invoices(epicor_tenant_company);

-- 5. 提高日期范围查询性能
-- 用于按订单日期范围查询发票
CREATE INDEX IF NOT EXISTS idx_invoice_order_date 
ON invoices(order_date);

-- 6. 提高清理过期数据性能
-- 用于快速查找需要清理的已提交发票
CREATE INDEX IF NOT EXISTS idx_invoice_cleanup 
ON invoices(created_at, status) 
WHERE status = 'SUBMITTED';

-- 验证索引创建
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'invoices' 
AND indexname LIKE 'idx_invoice_%'
ORDER BY indexname; 