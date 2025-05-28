# 多租户发票同步功能

## 概述

本系统实现了基于customer-hub RPC接口的多租户发票增量同步功能，支持从多个Epicor环境自动同步发票数据到本地缓存。

## 主要功能

### 1. 多租户配置管理

- **RPC接口集成**: 通过customer-hub的RPC接口获取租户配置
- **动态租户发现**: 自动获取拥有einvoice应用的所有租户
- **配置缓存**: 支持租户级别的Epicor服务器配置

### 2. 增量同步机制

- **定时同步**: 每3分钟自动执行一次增量同步
- **多租户并行**: 同时为所有活跃租户执行同步
- **增量策略**: 基于数据库最新创建时间进行增量同步
- **只插入策略**: 新数据只插入，不更新已存在的记录

### 3. 租户隔离

- **epicor_tenant_company字段**: 每条发票记录包含租户公司标识
- **标识生成规则**: `{environment}_{companyID}` (如: `simalfaprod_TC`)
- **数据隔离**: 基于epicor_tenant_company进行数据查询和同步

## 技术实现

### 核心组件

#### 1. TenantConfigService

新增方法：
- `getTenantsByApplication(appCode)`: 获取拥有指定应用的租户列表
- `getAppConfigByTenantId(tenantId, appCode)`: 根据租户ID获取应用配置

#### 2. InvoiceCacheService

重构功能：
- 移除`lastSyncTimestamp`内存缓存
- 实现基于数据库的增量同步时间获取
- 支持多租户并行同步
- 只插入不更新的数据处理策略

#### 3. Invoice实体

已包含字段：
- `epicor_tenant_company`: 租户公司标识字段

### API端点

#### 缓存管理端点

```
POST /invoice/cache/sync              # 手动触发缓存同步
POST /invoice/cache/force-sync        # 强制全量缓存同步
GET  /invoice/cache/stats             # 获取缓存统计信息
POST /invoice/cache/cleanup           # 清理过期缓存
GET  /invoice/cache/test-tenant-configs # 测试租户配置获取
```

## 配置要求

### Customer-Hub RPC接口

系统使用真正的RPC调用与customer-hub服务通信，支持TCP和gRPC两种传输协议。

#### RPC方法定义

1. **获取应用租户列表**
   ```
   方法: getTenantsByApplication
   参数: { appCode: string }
   返回: TenantInfo[]
   ```
   返回格式：
   ```typescript
   interface TenantInfo {
     tenantId: string;
     tenantName: string;
     status: string;
   }
   ```

2. **获取租户应用配置（系统级调用）**
   ```
   方法: getAppConfigByTenantId
   参数: { tenantId: string, appCode: string }
   返回: AppConfig | null
   ```

3. **获取租户应用配置（用户级调用）**
   ```
   方法: getAppConfig
   参数: { tenantId: string, appCode: string, authorization?: string }
   返回: AppConfig | null
   ```

   返回格式：
   ```typescript
   interface AppConfig {
     settings: {
       serverSettings?: {
         serverBaseAPI: string;
         companyID: string;
         userAccount: string;
         password?: string;
       };
       companyInfo?: any;
       taxAgencySettings?: any;
     };
   }
   ```

4. **连接测试**
   ```
   方法: ping
   参数: { timestamp: Date }
   返回: { pong: boolean, timestamp: Date }
   ```

#### RPC配置

系统支持两种RPC传输协议：

**TCP传输（默认）**
```env
CUSTOMER_HUB_RPC_HOST=localhost
CUSTOMER_HUB_RPC_PORT=5000
CUSTOMER_HUB_RPC_TRANSPORT=TCP
```

**gRPC传输**
```env
CUSTOMER_HUB_RPC_HOST=localhost
CUSTOMER_HUB_RPC_PORT=5000
CUSTOMER_HUB_RPC_TRANSPORT=GRPC
CUSTOMER_HUB_PROTO_PATH=./proto/customer-hub.proto
```

#### 故障转移机制

系统实现了RPC到HTTP的自动故障转移：

1. **优先使用RPC**: 所有调用首先尝试RPC接口
2. **HTTP回退**: 如果RPC调用失败，自动回退到HTTP REST接口
3. **默认配置**: 如果所有调用都失败，返回预设的默认配置

#### 连接管理

- **自动连接**: 服务启动时自动建立RPC连接
- **连接池**: 支持连接复用和池化管理
- **超时控制**: 所有RPC调用都有10秒超时限制
- **优雅关闭**: 服务停止时自动关闭RPC连接

### 环境变量

```env
CUSTOMER_PORTAL_URL=http://localhost:3000  # Customer-Hub服务地址
```

## 使用示例

### 1. 查看租户配置

```bash
curl -X GET "http://localhost:3000/invoice/cache/test-tenant-configs"
```

### 2. 手动触发同步

```bash
# 为所有租户同步
curl -X POST "http://localhost:3000/invoice/cache/sync"

# 为特定租户同步（需要认证）
curl -X POST "http://localhost:3000/invoice/cache/sync" \
  -H "Authorization: Bearer <token>"
```

### 3. 查看缓存统计

```bash
curl -X GET "http://localhost:3000/invoice/cache/stats"
```

返回示例：
```json
{
  "totalInvoices": 1500,
  "totalDetails": 3200,
  "statusDistribution": {
    "PENDING": 800,
    "SUBMITTED": 650,
    "ERROR": 50
  },
  "tenantDistribution": {
    "simalfaprod_TC": 800,
    "testenv_DEMO": 700
  },
  "oldestInvoice": "2024-01-01T00:00:00.000Z",
  "newestInvoice": "2024-12-20T10:30:00.000Z"
}
```

## 数据流程

### 1. 定时同步流程

```
每3分钟 → 调用customer-hub RPC接口 → 获取所有租户配置 → 
为每个租户并行执行：
  ├─ 生成epicor_tenant_company标识
  ├─ 查询该租户最新同步时间
  ├─ 构建增量查询条件
  ├─ 从Epicor获取增量数据
  └─ 插入新发票记录（跳过已存在）
```

### 2. epicor_tenant_company生成规则

```javascript
// 输入: https://simalfa.kineticcloud.cn/simalfaprod/api/v1, TC
// 输出: simalfaprod_TC

function generateEpicorTenantCompany(serverBaseAPI, companyID) {
  const url = new URL(serverBaseAPI);
  const pathParts = url.pathname.split('/').filter(part => part.length > 0);
  const environment = pathParts.find(part => part !== 'api' && part !== 'v1') || 'default';
  return `${environment}_${companyID}`;
}
```

## 监控和日志

### 日志级别

- **INFO**: 同步开始/完成、租户配置获取
- **WARN**: 配置缺失、跳过的租户
- **ERROR**: 同步失败、配置错误
- **DEBUG**: 跳过的重复发票

### 关键日志示例

```
[InvoiceCacheService] Starting scheduled incremental sync from Epicor for all tenants
[TenantConfigService] Retrieved 3 tenants for app: einvoice
[InvoiceCacheService] Starting incremental sync for tenant tenant1 (simalfaprod_TC) since: 2024-12-20T08:00:00.000Z
[InvoiceCacheService] Incremental sync completed for tenant tenant1 (simalfaprod_TC). Processed 15 invoices
[InvoiceCacheService] Scheduled sync completed. Success: 3, Failures: 0
```

## 故障排除

### 常见问题

1. **租户配置获取失败**
   - 检查CUSTOMER_PORTAL_URL配置
   - 确认customer-hub服务可访问
   - 验证RPC接口返回格式

2. **同步失败**
   - 检查Epicor服务器配置
   - 验证网络连接
   - 查看详细错误日志

3. **重复数据**
   - 系统会自动跳过已存在的发票
   - 基于erpInvoiceId和epicorTenantCompany判断

### 调试命令

```bash
# 测试租户配置获取
curl -X GET "http://localhost:3000/invoice/cache/test-tenant-configs"

# 查看缓存统计
curl -X GET "http://localhost:3000/invoice/cache/stats"

# 手动触发同步并查看日志
curl -X POST "http://localhost:3000/invoice/cache/sync"
```

## 性能优化

### 同步策略

- **批量处理**: 每次最多同步500条记录
- **并行执行**: 多租户同步并行进行
- **增量查询**: 只获取新增/更新的数据
- **跳过重复**: 避免重复插入已存在的记录

### 数据库优化

建议添加索引：
```sql
-- 提高同步时间查询性能
CREATE INDEX idx_invoice_tenant_created ON invoices(epicor_tenant_company, created_at);

-- 提高重复检查性能
CREATE INDEX idx_invoice_tenant_erp_id ON invoices(epicor_tenant_company, erp_invoice_id);
```

## 版本历史

- **v1.0**: 初始多租户同步功能实现
- 支持customer-hub RPC接口集成
- 实现epicor_tenant_company字段
- 移除内存缓存，改用数据库查询
- 实现只插入不更新策略 