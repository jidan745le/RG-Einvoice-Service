import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class TenantConfigService {
    private readonly logger = new Logger(TenantConfigService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

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
                'http://localhost:3000'
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
} 