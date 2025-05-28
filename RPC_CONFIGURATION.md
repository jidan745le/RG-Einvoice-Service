# RPC配置指南

## 环境变量配置

### Customer Hub RPC配置

```env
# RPC服务器地址
CUSTOMER_HUB_RPC_HOST=localhost

# RPC服务器端口
CUSTOMER_HUB_RPC_PORT=5000

# RPC传输协议 (TCP 或 GRPC)
CUSTOMER_HUB_RPC_TRANSPORT=TCP

# gRPC Proto文件路径（仅当使用gRPC时需要）
CUSTOMER_HUB_PROTO_PATH=./proto/customer-hub.proto
```

### HTTP故障转移配置

```env
# Customer Portal HTTP地址（RPC故障转移时使用）
CUSTOMER_PORTAL_URL=http://localhost:3000
```

## RPC接口规范

### 1. getTenantsConfigByApplication

**描述**: 根据应用代码获取租户配置列表（包含完整的租户、应用和设置信息）

**参数**:
```typescript
{
  appCode: string  // 应用代码，如 'einvoice'
}
```

**返回**:
```typescript
TenantConfig[] = [
  {
    tenant: {
      id: string,                // 租户ID
      name: string,              // 租户名称
      subscription_plan: string  // 订阅计划
    },
    application: {
      id: string,    // 应用ID
      code: string,  // 应用代码
      name: string,  // 应用名称
      path: string,  // 应用路径
      url: string    // 应用URL
    },
    settings: string  // JSON字符串格式的设置数据
  }
]
```

### 2. getAppConfigByTenantId

**描述**: 根据租户ID获取应用配置（系统级调用，无需授权）

**参数**:
```typescript
{
  tenantId: string,  // 租户ID
  appCode: string    // 应用代码
}
```

**返回**:
```typescript
{
  config: TenantConfig  // 租户配置对象，格式同上
}
```

### 3. getAppConfig

**描述**: 根据租户ID获取应用配置（用户级调用，需要授权）

**参数**:
```typescript
{
  tenantId: string,      // 租户ID
  appCode: string,       // 应用代码
  authorization?: string // 授权头
}
```

**返回**: 同 `getAppConfigByTenantId`

### 4. ping

**描述**: 测试RPC连接

**参数**:
```typescript
{
  timestamp: number  // 时间戳（毫秒）
}
```

**返回**:
```typescript
{
  pong: boolean,     // 响应标识
  timestamp: number  // 服务器时间戳（毫秒）
}
```

## 数据结构说明

### 租户配置格式

实际的租户配置数据结构如下：

```javascript
const config = {
  tenant: {
    id: tenant.id,
    name: tenant.name,
    subscription_plan: tenant.subscription_plan,
  },
  application: {
    id: tenantApplication.application.id,
    code: tenantApplication.application.code,
    name: tenantApplication.application.name,
    path: tenantApplication.application.path,
    url: tenantApplication.application.url,
  },
  settings: {
    ...tenant.custom_settings,
    ...(tenantApplication.settings || {}),
  },
};
```

**注意**: 在RPC传输中，`settings`字段会被序列化为JSON字符串，客户端接收后需要使用`JSON.parse()`进行反序列化。

## 实现示例

### TCP RPC服务器示例 (Node.js)

```javascript
const { Transport } = require('@nestjs/microservices');
const { NestFactory } = require('@nestjs/core');

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.TCP,
    options: {
      host: 'localhost',
      port: 5000,
    },
  });
  
  await app.listen();
  console.log('Customer Hub RPC server is listening on port 5000');
}

bootstrap();
```

### gRPC Proto文件示例

```protobuf
syntax = "proto3";

package customerhub;

service CustomerHubService {
  rpc GetTenantsByApplication(GetTenantsRequest) returns (GetTenantsResponse);
  rpc GetAppConfigByTenantId(GetConfigRequest) returns (GetConfigResponse);
  rpc GetAppConfig(GetConfigWithAuthRequest) returns (GetConfigResponse);
  rpc Ping(PingRequest) returns (PingResponse);
}

message GetTenantsRequest {
  string appCode = 1;
}

message GetTenantsResponse {
  repeated TenantInfo tenants = 1;
}

message TenantInfo {
  string tenantId = 1;
  string tenantName = 2;
  string status = 3;
}

message GetConfigRequest {
  string tenantId = 1;
  string appCode = 2;
}

message GetConfigWithAuthRequest {
  string tenantId = 1;
  string appCode = 2;
  string authorization = 3;
}

message GetConfigResponse {
  string configJson = 1;  // JSON格式的配置数据
}

message PingRequest {
  int64 timestamp = 1;
}

message PingResponse {
  bool pong = 1;
  int64 timestamp = 2;
}
```

## 故障转移机制

系统实现了多层故障转移：

1. **RPC优先**: 所有调用首先尝试RPC接口
2. **HTTP回退**: RPC失败时自动回退到HTTP REST接口
3. **默认配置**: 所有调用都失败时返回预设默认配置

### 故障转移日志示例

```
[CustomerHubRpcService] RPC call: getTenantsByApplication with appCode: einvoice
[CustomerHubRpcService] RPC call failed: Connection refused
[TenantConfigService] RPC call failed, falling back to HTTP
[TenantConfigService] Retrieved 2 tenants for app: einvoice via HTTP fallback
```

## 测试和调试

### 测试RPC连接

```bash
curl -X GET "http://localhost:3003/invoice/cache/test-rpc-connection"
```

### 测试租户配置获取

```bash
curl -X GET "http://localhost:3003/invoice/cache/test-tenant-configs"
```

### 运行完整测试

```bash
node test-multi-tenant-sync.js
```

## 性能优化

### 连接池配置

- **连接复用**: RPC客户端自动复用连接
- **超时控制**: 所有RPC调用10秒超时
- **重试机制**: 失败时自动重试HTTP接口

### 监控指标

- RPC调用成功率
- HTTP回退频率
- 平均响应时间
- 连接池状态

## 故障排除

### 常见问题

1. **RPC连接失败**
   - 检查 `CUSTOMER_HUB_RPC_HOST` 和 `CUSTOMER_HUB_RPC_PORT`
   - 确认Customer Hub RPC服务正在运行
   - 检查网络连接和防火墙设置

2. **gRPC Proto文件错误**
   - 验证 `CUSTOMER_HUB_PROTO_PATH` 路径正确
   - 确认proto文件语法正确
   - 检查package名称匹配

3. **HTTP回退失败**
   - 检查 `CUSTOMER_PORTAL_URL` 配置
   - 确认HTTP服务可访问
   - 验证API端点路径正确

### 调试命令

```bash
# 检查RPC连接
curl -X GET "http://localhost:3003/invoice/cache/test-rpc-connection"

# 查看详细日志
tail -f logs/application.log | grep -E "(RPC|CustomerHub)"

# 测试HTTP回退
# 临时停止RPC服务，然后测试配置获取
curl -X GET "http://localhost:3003/invoice/cache/test-tenant-configs"
``` 