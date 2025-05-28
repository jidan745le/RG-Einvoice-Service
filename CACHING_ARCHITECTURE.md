# E-Invoice Caching Architecture

## 概述

本文档描述了E-Invoice应用的新缓存架构实现，该架构旨在改善性能、减少对Epicor的直接调用频率，并提供更好的用户体验。

## 架构设计

根据序列图要求，我们实现了一个三层缓存架构：

### 1. 数据同步层 (Data Sync Layer)
- **自动增量同步**: 每3分钟从Epicor获取增量数据并更新本地缓存
- **手动同步**: 支持手动触发增量同步或全量同步
- **智能同步**: 基于时间戳的增量更新，避免重复数据传输

### 2. 查询层 (Query Layer)
- **本地缓存优先**: 默认使用本地缓存数据库(LCD)进行查询
- **智能路由**: 根据查询参数自动选择数据源
- **回退机制**: 缓存查询失败时自动回退到Epicor直查

### 3. 操作层 (Operation Layer)
- **实时数据获取**: 操作时从Epicor获取最新数据
- **百望API集成**: 调用百望开票API
- **双向更新**: 同时更新Epicor和本地缓存

## 服务架构

### 核心服务

#### 1. InvoiceCacheService
负责缓存数据的管理和同步

**主要功能**:
- 自动3分钟增量同步 (`performIncrementalSync()`)
- 手动触发同步 (`triggerIncrementalSync()`)
- 本地缓存查询 (`findAllFromCache()`)
- 缓存统计和清理

**关键方法**:
```typescript
// 增量同步
await invoiceCacheService.triggerIncrementalSync(tenantId, authorization);

// 全量同步
await invoiceCacheService.forceFullSync(tenantId, authorization);

// 缓存查询
const result = await invoiceCacheService.findAllFromCache(queryDto);
```

#### 2. InvoiceQueryService
智能查询路由服务

**主要功能**:
- 智能数据源选择
- 查询参数分析
- 回退机制处理

**查询优先级**:
1. 如果 `fromEpicor=true` → 直接查询Epicor
2. 如果包含实时字段 (`eInvoiceId`, `submittedBy`) → 查询Epicor
3. 其他情况 → 使用本地缓存

```typescript
// 使用缓存查询
const result = await invoiceQueryService.findAll(queryDto, tenantId, authorization);

// 强制Epicor查询
const result = await invoiceQueryService.findAll({...queryDto, fromEpicor: true}, tenantId, authorization);
```

#### 3. InvoiceOperationService
发票操作服务，处理提交和合并操作

**操作流程**:
1. 从Epicor获取实时数据
2. 调用百望开票API
3. 更新Epicor状态
4. 更新本地缓存

```typescript
// 提交发票
await invoiceOperationService.submitInvoice(invoiceId, submittedBy, tenantId, authorization);

// 合并发票
await invoiceOperationService.mergeAndSubmitInvoices(mergeDto, tenantId, authorization);
```

## API 端点

### 查询相关

#### GET /invoice
智能查询发票列表
- 默认使用缓存
- 支持 `fromEpicor=true` 强制Epicor查询
- 自动回退机制

```bash
# 使用缓存查询
GET /invoice?page=1&limit=10&customerName=test

# 强制Epicor查询
GET /invoice?page=1&limit=10&fromEpicor=true

# 实时字段查询（自动路由到Epicor）
GET /invoice?eInvoiceId=INV123456
```

#### GET /invoice/:id
获取单个发票详情（使用操作服务）

### 操作相关

#### POST /invoice/:id/submit
提交发票到百望开票（使用新操作流程）

#### POST /invoice/merge
合并发票并提交（使用新操作流程）

### 缓存管理

#### POST /invoice/cache/sync
手动触发增量同步

#### POST /invoice/cache/force-sync
强制全量同步

#### GET /invoice/cache/stats
获取缓存统计信息

#### POST /invoice/cache/cleanup
清理过期缓存数据

## 配置

### 调度配置
自动同步任务每3分钟执行一次：
```typescript
@Cron('*/3 * * * *') // Every 3 minutes
async performIncrementalSync(): Promise<void>
```

### 数据源选择规则
```typescript
// 实时字段检测
private shouldQueryEpicorDirectly(queryDto: QueryInvoiceDto): boolean {
    const realTimeFields = ['eInvoiceId', 'submittedBy'];
    return realTimeFields.some(field => queryDto[field] !== undefined);
}
```

## 性能优化

### 1. 增量同步
- 基于 `ELIEInvUpdatedOn` 时间戳
- 限制单次同步数量 (top: 500)
- 租户级别的同步状态跟踪

### 2. 查询优化
- 本地数据库索引
- 分页查询
- 状态统计缓存

### 3. 并行处理
- 合并操作的并行数据获取
- 并行状态更新（Epicor + 缓存）

## 错误处理

### 1. 缓存同步错误
- 记录错误日志
- 继续执行后续同步
- 不影响正常查询功能

### 2. 查询回退
- 缓存查询失败时自动切换到Epicor
- 保持API响应一致性

### 3. 操作错误处理
- Epicor状态更新失败时记录错误
- 本地缓存状态同步
- 详细错误信息记录

## 监控和维护

### 缓存统计
```typescript
{
  totalInvoices: number,
  totalDetails: number,
  statusDistribution: Record<string, number>,
  lastSyncTimes: Record<string, Date>,
  oldestInvoice: Date | null,
  newestInvoice: Date | null
}
```

### 日志记录
- 同步操作日志
- 查询路由决策日志
- 错误详情记录

### 数据清理
- 自动清理30天前的已提交发票
- 可配置清理策略
- 保留活跃数据

## 使用示例

### 1. 前端查询发票列表
```typescript
// 快速查询（使用缓存）
const response = await fetch('/api/invoice?page=1&limit=10');

// 获取最新状态（使用Epicor）
const response = await fetch('/api/invoice?page=1&limit=10&fromEpicor=true');
```

### 2. 提交发票操作
```typescript
const response = await fetch('/api/invoice/123/submit', {
  method: 'POST',
  body: JSON.stringify({ submittedBy: 'user123' }),
  headers: { 'Content-Type': 'application/json' }
});
```

### 3. 缓存管理
```typescript
// 手动同步
await fetch('/api/invoice/cache/sync', { method: 'POST' });

// 查看统计
const stats = await fetch('/api/invoice/cache/stats').then(r => r.json());
```

## 部署注意事项

1. **数据库迁移**: 确保Invoice和InvoiceDetail表结构正确
2. **调度服务**: 启用 `@nestjs/schedule` 模块
3. **权限配置**: 确保Epicor API访问权限
4. **监控**: 设置缓存同步状态监控
5. **备份**: 定期备份本地缓存数据

## 性能指标

- **查询响应时间**: 缓存查询 < 100ms, Epicor查询 < 2s
- **同步频率**: 每3分钟增量同步
- **数据一致性**: 最大延迟3分钟
- **错误率**: 同步错误率 < 1%

## 故障排除

### 常见问题

1. **同步失败**
   - 检查Epicor连接配置
   - 验证认证信息
   - 查看详细错误日志

2. **查询缓慢**
   - 检查数据库索引
   - 考虑增加缓存清理频率
   - 优化查询条件

3. **数据不一致**
   - 触发强制全量同步
   - 检查同步时间戳
   - 验证Epicor数据更新

### 诊断命令
```bash
# 查看缓存统计
curl -X GET /api/invoice/cache/stats

# 强制同步
curl -X POST /api/invoice/cache/force-sync

# 清理缓存
curl -X POST /api/invoice/cache/cleanup -d '{"olderThanDays": 7}'
```

这个缓存架构确保了E-Invoice应用既能提供快速的查询响应，又能保持数据的实时性和准确性，完全符合序列图中描述的工作流程要求。 