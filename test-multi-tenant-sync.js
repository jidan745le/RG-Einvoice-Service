#!/usr/bin/env node

/**
 * 多租户发票同步功能测试脚本
 * 使用方法: node test-multi-tenant-sync.js [base_url]
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.argv[2] || 'http://localhost:3000';

// 简单的HTTP请求函数
function makeRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (data && method !== 'GET') {
            const postData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = lib.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve({ status: res.statusCode, data: result });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (data && method !== 'GET') {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

// 测试函数
async function runTests() {
    console.log('🚀 开始测试多租户发票同步功能...\n');
    console.log(`📍 测试服务器: ${BASE_URL}\n`);

    const tests = [
        {
            name: '1. 测试RPC连接',
            url: `${BASE_URL}/invoice/cache/test-rpc-connection`,
            method: 'GET'
        },
        {
            name: '2. 测试租户配置获取',
            url: `${BASE_URL}/invoice/cache/test-tenant-configs`,
            method: 'GET'
        },
        {
            name: '3. 获取缓存统计信息',
            url: `${BASE_URL}/invoice/cache/stats`,
            method: 'GET'
        },
        {
            name: '4. 手动触发缓存同步',
            url: `${BASE_URL}/invoice/cache/sync`,
            method: 'POST'
        },
        {
            name: '5. 查询发票列表（缓存）',
            url: `${BASE_URL}/invoice?page=1&limit=5`,
            method: 'GET'
        }
    ];

    for (const test of tests) {
        try {
            console.log(`🔍 ${test.name}`);
            console.log(`   请求: ${test.method} ${test.url}`);

            const result = await makeRequest(test.url, test.method, test.data);

            console.log(`   状态: ${result.status}`);

            if (result.status >= 200 && result.status < 300) {
                console.log('   ✅ 成功');

                // 显示关键信息
                if (test.name.includes('RPC连接')) {
                    if (result.data.success !== undefined) {
                        console.log(`   📊 RPC连接状态: ${result.data.success ? '成功' : '失败'}`);
                        console.log(`   📊 消息: ${result.data.message}`);
                        if (result.data.timestamp) {
                            console.log(`   📊 时间戳: ${result.data.timestamp}`);
                        }
                    }
                } else if (test.name.includes('租户配置')) {
                    if (result.data.success && result.data.configs) {
                        console.log(`   📊 找到 ${result.data.tenantCount} 个租户配置:`);
                        result.data.configs.forEach(config => {
                            console.log(`      - ${config.tenantId}: ${config.epicorTenantCompany}`);
                            if (config.application) {
                                console.log(`        应用: ${config.application.name} (${config.application.code})`);
                            }
                            if (config.tenant) {
                                console.log(`        租户: ${config.tenant.name} (${config.tenant.subscription_plan})`);
                            }
                        });
                    }
                } else if (test.name.includes('缓存统计')) {
                    if (result.data.totalInvoices !== undefined) {
                        console.log(`   📊 发票总数: ${result.data.totalInvoices}`);
                        console.log(`   📊 明细总数: ${result.data.totalDetails}`);
                        if (result.data.tenantDistribution) {
                            console.log('   📊 租户分布:');
                            Object.entries(result.data.tenantDistribution).forEach(([tenant, count]) => {
                                console.log(`      - ${tenant}: ${count}`);
                            });
                        }
                    }
                } else if (test.name.includes('同步')) {
                    if (result.data.success !== undefined) {
                        console.log(`   📊 同步结果: ${result.data.success ? '成功' : '失败'}`);
                        if (result.data.message) {
                            console.log(`   📊 消息: ${result.data.message}`);
                        }
                    }
                } else if (test.name.includes('发票列表')) {
                    if (result.data.items) {
                        console.log(`   📊 返回 ${result.data.items.length} 条发票记录`);
                        console.log(`   📊 总数: ${result.data.total}`);
                        if (result.data.dataSource) {
                            console.log(`   📊 数据源: ${result.data.dataSource}`);
                        }
                    }
                }
            } else {
                console.log('   ❌ 失败');
                console.log(`   错误: ${JSON.stringify(result.data, null, 2)}`);
            }

        } catch (error) {
            console.log('   ❌ 请求失败');
            console.log(`   错误: ${error.message}`);
        }

        console.log('');
    }

    console.log('🎉 测试完成!\n');

    // 提供使用建议
    console.log('💡 使用建议:');
    console.log('1. 确保customer-hub服务正在运行并配置了正确的租户数据');
    console.log('2. 检查CUSTOMER_PORTAL_URL环境变量是否正确设置');
    console.log('3. 验证Epicor服务器配置是否完整');
    console.log('4. 监控日志以查看详细的同步过程');
    console.log('\n📚 更多信息请参考: MULTI_TENANT_SYNC_README.md');
}

// 运行测试
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { makeRequest, runTests }; 