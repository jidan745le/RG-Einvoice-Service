#!/usr/bin/env node

/**
 * 模拟Customer Hub RPC服务器
 * 用于测试RPC客户端功能
 */

const net = require('net');

// 模拟数据
const mockTenantConfigs = [
    {
        tenant: {
            id: 'tenant1',
            name: '租户1',
            subscription_plan: 'premium'
        },
        application: {
            id: 'app1',
            code: 'einvoice',
            name: 'E-Invoice System',
            path: '/einvoice',
            url: 'http://localhost:3003'
        },
        settings: JSON.stringify({
            serverSettings: {
                serverBaseAPI: 'https://simalfa.kineticcloud.cn/simalfaprod/api/v1',
                companyID: 'TC',
                userAccount: 'testuser',
                password: 'testpass'
            },
            companyInfo: {
                tel: "15888888888",
                taxNo: "338888888888SMB",
                companyName: "测试公司1"
            }
        })
    },
    {
        tenant: {
            id: 'tenant2',
            name: '租户2',
            subscription_plan: 'standard'
        },
        application: {
            id: 'app1',
            code: 'einvoice',
            name: 'E-Invoice System',
            path: '/einvoice',
            url: 'http://localhost:3003'
        },
        settings: JSON.stringify({
            serverSettings: {
                serverBaseAPI: 'https://demo.kineticcloud.cn/demoenv/api/v1',
                companyID: 'DEMO',
                userAccount: 'demouser',
                password: 'demopass'
            },
            companyInfo: {
                tel: "13999999999",
                taxNo: "999999999999SMB",
                companyName: "测试公司2"
            }
        })
    }
];

// 处理RPC请求
function handleRpcRequest(pattern, data) {
    console.log(`📨 收到RPC请求: ${pattern}`, data);

    switch (pattern) {
        case 'getTenantsConfigByApplication':
            const appCode = data.appCode || 'einvoice';
            console.log(`   🔍 查询应用: ${appCode}`);
            return mockTenantConfigs;

        case 'getAppConfigByTenantId':
            const tenantId = data.tenantId;
            const config = mockTenantConfigs.find(c => c.tenant.id === tenantId);
            console.log(`   🔍 查询租户配置: ${tenantId}`);
            return config ? { config } : null;

        case 'ping':
            console.log(`   🏓 Ping请求`);
            return {
                pong: true,
                timestamp: Date.now()
            };

        default:
            console.log(`   ❓ 未知请求: ${pattern}`);
            return null;
    }
}

// 创建TCP服务器
const server = net.createServer((socket) => {
    console.log(`🔗 客户端连接: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📥 收到消息:`, message);

            const response = handleRpcRequest(message.pattern, message.data);

            const responseMessage = {
                id: message.id,
                response: response,
                isDisposed: false
            };

            socket.write(JSON.stringify(responseMessage) + '\n');
            console.log(`📤 发送响应:`, responseMessage);

        } catch (error) {
            console.error(`❌ 处理消息错误:`, error.message);

            const errorResponse = {
                id: message?.id || 'unknown',
                err: error.message,
                isDisposed: false
            };

            socket.write(JSON.stringify(errorResponse) + '\n');
        }
    });

    socket.on('close', () => {
        console.log(`🔌 客户端断开连接`);
    });

    socket.on('error', (error) => {
        console.error(`❌ Socket错误:`, error.message);
    });
});

const PORT = 5000;
const HOST = 'localhost';

server.listen(PORT, HOST, () => {
    console.log(`🚀 Mock RPC服务器启动成功!`);
    console.log(`📍 监听地址: ${HOST}:${PORT}`);
    console.log(`📋 支持的RPC方法:`);
    console.log(`   - getTenantsConfigByApplication`);
    console.log(`   - getAppConfigByTenantId`);
    console.log(`   - ping`);
    console.log(`\n💡 使用 Ctrl+C 停止服务器\n`);
});

server.on('error', (error) => {
    console.error(`❌ 服务器错误:`, error.message);
    process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log(`\n🛑 正在关闭服务器...`);
    server.close(() => {
        console.log(`✅ 服务器已关闭`);
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log(`\n🛑 收到终止信号，正在关闭服务器...`);
    server.close(() => {
        console.log(`✅ 服务器已关闭`);
        process.exit(0);
    });
}); 