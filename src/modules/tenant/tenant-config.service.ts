import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { CustomerHubRpcService } from './customer-hub-rpc.service';

@Injectable()
export class TenantConfigService {
    private readonly logger = new Logger(TenantConfigService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly customerHubRpcService: CustomerHubRpcService,
    ) { }

    async onModuleInit() {
        console.log('onModuleInit TenantConfigService');
    }

    /**
     * 从客户门户获取应用配置
     * @param tenantId 租户ID
     * @param appCode 应用代码
     * @param authorization 认证头信息
     * @returns 应用配置
     */
    async getAppConfig(tenantId: string, appCode: string = 'einvoice', authorization?: string): Promise<any> {
        this.logger.log(`Getting app config for tenant: ${tenantId}, app: ${appCode}`);
        try {
            const customerPortalUrl = this.configService.get<string>(
                'CUSTOMER_PORTAL_URL',
                'http://127.0.0.1:3000'
            );

            // 检查是否提供了认证信息
            if (!authorization) {
                throw new Error('No authorization header provided');
            }

            const response = await lastValueFrom(
                this.httpService.get(
                    `${customerPortalUrl}/app-config?appcode=${appCode}`,
                    {
                        headers: {
                            Authorization: authorization,
                        },
                    }
                )
            );

            return response.data;
        } catch (error) {
            this.logger.error(`Failed to get app config: ${error.message}`, error.stack);
            // 返回默认配置
            return {
                settings: {
                    companyInfo: {
                        tel: "15888888888",
                        taxNo: "338888888888SMB",
                        drawer: "338888888888SMB",
                        address: "338888888888SMB",
                        bankName: "338888888888SMB",
                        bankAccount: "338888888888SMB",
                        companyName: "338888888888SMB"
                    },
                    taxAgencySettings: {
                        salt: "521c0eea19f04367ad20a3be12c9b4bc",
                        token: "9a38e3c2-175e-49a1-a56b-9ad0c5502aa2",
                        appKey: "1002948",
                        baseURL: "https://sandbox-openapi.baiwang.com/router/rest",
                        version: "6.0",
                        password: "Aa2345678@",
                        appSecret: "223998c6-5b76-4724-b5c9-666ff4215b45",
                        connector: "CN - BW",
                        userAccount: "admin_3sylog6ryv8cs"
                    }
                }
            };
        }
    }

    /**
     * 获取百望配置
     * @param tenantId 租户ID
     * @param authorization 认证头信息
     * @returns 百望配置
     */
    async getBaiwangConfig(tenantId: string, authorization?: string): Promise<any> {
        const appConfig = await this.getAppConfig(tenantId, 'einvoice', authorization);
        const taxAgencySettings = appConfig?.settings?.taxAgencySettings || {};

        return {
            apiName: 'baiwang.s.outputinvoice.invoice',
            appKey: taxAgencySettings.appKey || '',
            appSecret: taxAgencySettings.appSecret || '',
            token: taxAgencySettings.token || '',
            baseUrl: taxAgencySettings.baseURL || 'https://sandbox-openapi.baiwang.com/router/rest',
            version: taxAgencySettings.version || '6.0',
        };
    }

    /**
     * 获取公司信息配置
     * @param tenantId 租户ID
     * @param authorization 认证头信息
     * @returns 公司信息配置
     */
    async getCompanyInfo(tenantId: string, authorization?: string): Promise<any> {
        const appConfig = await this.getAppConfig(tenantId, 'einvoice', authorization);
        return appConfig?.settings?.companyInfo || {};
    }

    /**
     * 根据应用获取拥有该应用的租户配置（使用RPC接口）
     * @param appCode 应用代码
     * @returns 租户配置列表
     */
    async getTenantsByApplication(appCode: string = 'einvoice'): Promise<any[]> {
        this.logger.log(`Getting tenants by application via RPC: ${appCode}`);

        try {
            // 使用RPC调用获取租户配置列表
            const tenantConfigs = await this.customerHubRpcService.getTenantsConfigByApplication(appCode);
            this.logger.log(`Retrieved ${tenantConfigs.length} tenant configs for app: ${appCode} via RPC`);

            // 转换为兼容的格式，保持向后兼容
            const tenants = tenantConfigs.map(config => ({
                tenantId: config.tenant.id,
                tenantName: config.tenant.name,
                status: 'active', // 默认状态
                subscription_plan: config.tenant.subscription_plan,
                application: config.application,
                settings: config.settings
            }));

            return tenants;
        } catch (error) {
            this.logger.error(`RPC call failed for getTenantsConfigByApplication: ${error.message}`, error.stack);

            // 如果RPC失败，尝试HTTP回退
            this.logger.warn('Falling back to HTTP for getTenantsByApplication');
            try {
                const customerPortalUrl = this.configService.get<string>(
                    'CUSTOMER_PORTAL_URL',
                    'http://localhost:3000'
                );

                const response = await lastValueFrom(
                    this.httpService.get(
                        `${customerPortalUrl}/app-tenants?appcode=${appCode}`,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                        }
                    )
                );

                this.logger.log(`Retrieved ${response.data?.length || 0} tenants for app: ${appCode} via HTTP fallback`);
                return response.data || [];
            } catch (httpError) {
                this.logger.error(`HTTP fallback also failed: ${httpError.message}`, httpError.stack);
                // 返回空数组，避免中断服务
                return [];
            }
        }
    }

    /**
     * 根据租户ID和应用代码获取配置（无需授权头的系统级调用，使用RPC接口）
     * @param tenantId 租户ID
     * @param appCode 应用代码
     * @returns 应用配置
     */
    async getAppConfigByTenantId(tenantId: string, appCode: string = 'einvoice'): Promise<any> {
        this.logger.log(`Getting app config by tenant ID via RPC: ${tenantId}, app: ${appCode}`);

        try {
            // 使用RPC调用获取配置
            const tenantConfig = await this.customerHubRpcService.getAppConfigByTenantId(tenantId, appCode);
            if (tenantConfig) {
                this.logger.log(`Retrieved config for tenant ${tenantId} via RPC`);

                // 转换为兼容的格式
                return {
                    tenant: tenantConfig.tenant,
                    application: tenantConfig.application,
                    settings: tenantConfig.settings
                };
            }
        } catch (error) {
            this.logger.error(`RPC call failed for getAppConfigByTenantId: ${error.message}`, error.stack);
        }

        // 如果RPC失败，尝试HTTP回退
        this.logger.warn('Falling back to HTTP for getAppConfigByTenantId');
        try {
            const customerPortalUrl = this.configService.get<string>(
                'CUSTOMER_PORTAL_URL',
                'http://127.0.0.1:3000'
            );

            const response = await lastValueFrom(
                this.httpService.get(
                    `${customerPortalUrl}/tenant/${tenantId}/app-config?appcode=${appCode}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }
                )
            );

            return response.data;
        } catch (httpError) {
            this.logger.error(`HTTP fallback also failed: ${httpError.message}`, httpError.stack);
            // 返回null，表示该租户没有配置
            return null;
        }
    }

    /**
     * 测试RPC连接
     * @returns 连接测试结果
     */
    async testRpcConnection(): Promise<any> {
        this.logger.log('Testing RPC connection to Customer Hub');
        return await this.customerHubRpcService.testConnection();
    }
} 