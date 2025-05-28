import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport, ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout, of } from 'rxjs';
import { Observable } from 'rxjs';

export interface TenantInfo {
    id: string;
    name: string;
    subscription_plan: string;
}

export interface ApplicationInfo {
    id: string;
    code: string;
    name: string;
    path: string;
    url: string;
}

export interface TenantConfig {
    tenant: TenantInfo;
    application: ApplicationInfo;
    settings: any; // 这里会是解析后的JSON对象
}

export interface AppConfig {
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

// gRPC服务接口定义
interface CustomerHubGrpcService {
    getTenantsConfigByApplication(data: { appCode: string }): Observable<{ configs: any[] }>;
    getAppConfigByTenantId(data: { tenantId: string; appCode: string }): Observable<{ config: any }>;
    ping(data: { timestamp: number }): Observable<{ success: boolean; message: string; timestamp: number }>;
}

@Injectable()
export class CustomerHubRpcService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CustomerHubRpcService.name);
    private client: ClientProxy | ClientGrpc;
    private grpcService: CustomerHubGrpcService;
    private rpcTransport: string;

    constructor(private readonly configService: ConfigService) {
        this.initializeRpcClient();
    }

    async onModuleInit() {
        try {
            if (this.rpcTransport.toUpperCase() === 'TCP') {
                // TCP模式需要手动连接
                await (this.client as ClientProxy).connect();
                this.logger.log('Connected to Customer Hub RPC service (TCP)');
            } else {
                // gRPC模式需要获取服务实例
                this.grpcService = (this.client as ClientGrpc).getService<CustomerHubGrpcService>('CustomerHubService');
                this.logger.log('Customer Hub RPC service initialized (gRPC - auto-connect)');
            }
        } catch (error) {
            this.logger.error(`Failed to connect to Customer Hub RPC service: ${error.message}`);
        }
    }

    async onModuleDestroy() {
        try {
            if (this.rpcTransport.toUpperCase() === 'TCP') {
                await (this.client as ClientProxy).close();
                this.logger.log('Disconnected from Customer Hub RPC service (TCP)');
            } else {
                this.logger.log('Customer Hub RPC service cleanup (gRPC - auto-disconnect)');
            }
        } catch (error) {
            this.logger.error(`Error closing Customer Hub RPC connection: ${error.message}`);
        }
    }

    private initializeRpcClient() {
        const rpcHost = this.configService.get<string>('CUSTOMER_HUB_RPC_HOST', 'localhost');
        const rpcPort = this.configService.get<number>('CUSTOMER_HUB_RPC_PORT', 8888);
        this.rpcTransport = this.configService.get<string>('CUSTOMER_HUB_RPC_TRANSPORT', 'GRPC');

        this.logger.log(`Initializing Customer Hub RPC client: ${this.rpcTransport}://${rpcHost}:${rpcPort}`);

        if (this.rpcTransport.toUpperCase() === 'GRPC') {
            console.log('GRPC transport');
            // gRPC transport
            this.client = ClientProxyFactory.create({
                transport: Transport.GRPC,
                options: {
                    package: 'customerhub',
                    protoPath: this.configService.get<string>('CUSTOMER_HUB_PROTO_PATH', './proto/customer-hub.proto'),
                    url: `${rpcHost}:${rpcPort}`,
                },
            }) as ClientGrpc;
        } else {
            console.log('TCP transport');
            // TCP transport
            this.client = ClientProxyFactory.create({
                transport: Transport.TCP,
                options: {
                    host: rpcHost,
                    port: rpcPort,
                },
            }) as ClientProxy;
        }
    }

    /**
     * 根据应用获取租户配置列表
     * @param appCode 应用代码
     * @returns 租户配置列表
     */
    async getTenantsConfigByApplication(appCode: string = 'einvoice'): Promise<TenantConfig[]> {
        this.logger.log(`RPC call: getTenantsConfigByApplication with appCode: ${appCode}`);

        try {
            let result: any;

            if (this.rpcTransport.toUpperCase() === 'GRPC') {
                // gRPC模式
                if (!this.grpcService) {
                    throw new Error('gRPC service not initialized');
                }
                console.log('GRPC mode getTenantsConfigByApplication');
                result = await firstValueFrom(
                    this.grpcService.getTenantsConfigByApplication({ appCode }).pipe(
                        timeout(10000)
                    )
                );
                console.log('GRPC mode getTenantsConfigByApplication result', result);
            } else {
                // TCP模式
                result = await firstValueFrom(
                    (this.client as ClientProxy).send('getTenantsConfigByApplication', { appCode }).pipe(
                        timeout(10000)
                    )
                );
            }

            // 处理返回的数据，解析settings JSON字符串
            let configs: any[];
            if (this.rpcTransport.toUpperCase() === 'GRPC') {
                // gRPC模式返回格式: { configs: [...] }
                configs = result?.configs || [];
            } else {
                // TCP模式直接返回数组
                configs = Array.isArray(result) ? result : [];
            }

            const processedConfigs: TenantConfig[] = configs.map(config => ({
                tenant: config.tenant,
                application: config.application,
                settings: typeof config.settings === 'string' ? JSON.parse(config.settings) : config.settings
            }));

            this.logger.log(`RPC response: Found ${processedConfigs.length} tenant configs for app: ${appCode}`);
            return processedConfigs;
        } catch (error) {
            this.logger.error(`RPC call failed for getTenantsConfigByApplication: ${error.message}`, error.stack);

            // 如果RPC调用失败，返回模拟数据以避免中断服务
            this.logger.warn('Falling back to mock tenant config list due to RPC failure');
            return this.getMockTenantConfigs();
        }
    }

    /**
     * 根据租户ID和应用代码获取配置
     * @param tenantId 租户ID
     * @param appCode 应用代码
     * @returns 应用配置
     */
    async getAppConfigByTenantId(tenantId: string, appCode: string = 'einvoice'): Promise<TenantConfig | null> {
        this.logger.log(`RPC call: getAppConfigByTenantId with tenantId: ${tenantId}, appCode: ${appCode}`);

        try {
            let result: any;

            if (this.rpcTransport.toUpperCase() === 'GRPC') {
                // gRPC模式
                if (!this.grpcService) {
                    throw new Error('gRPC service not initialized');
                }
                result = await firstValueFrom(
                    this.grpcService.getAppConfigByTenantId({ tenantId, appCode }).pipe(
                        timeout(10000)
                    )
                );
            } else {
                // TCP模式
                result = await firstValueFrom(
                    (this.client as ClientProxy).send('getAppConfigByTenantId', { tenantId, appCode }).pipe(
                        timeout(10000)
                    )
                );
            }

            if (result && result.config) {
                // 处理返回的数据，解析settings JSON字符串
                const config = result.config;
                const processedConfig: TenantConfig = {
                    tenant: config.tenant,
                    application: config.application,
                    settings: typeof config.settings === 'string' ? JSON.parse(config.settings) : config.settings
                };

                this.logger.log(`RPC response: Retrieved config for tenant ${tenantId}`);
                return processedConfig;
            }

            return null;
        } catch (error) {
            this.logger.error(`RPC call failed for getAppConfigByTenantId: ${error.message}`, error.stack);
            return null;
        }
    }

    /**
     * 测试RPC连接
     * @returns 连接状态
     */
    async testConnection(): Promise<{ success: boolean; message: string; timestamp: Date }> {
        this.logger.log('Testing RPC connection to Customer Hub');

        try {
            let result: any;

            if (this.rpcTransport.toUpperCase() === 'GRPC') {
                // gRPC模式
                if (!this.grpcService) {
                    throw new Error('gRPC service not initialized');
                }
                result = await firstValueFrom(
                    this.grpcService.ping({ timestamp: new Date().getTime() }).pipe(
                        timeout(5000)
                    )
                );
            } else {
                // TCP模式
                result = await firstValueFrom(
                    (this.client as ClientProxy).send('ping', { timestamp: new Date().getTime() }).pipe(
                        timeout(5000)
                    )
                );
            }

            this.logger.log('RPC connection test successful');
            return {
                success: true,
                message: `RPC connection successful (${this.rpcTransport})`,
                timestamp: new Date(),
                ...result
            };
        } catch (error) {
            this.logger.error(`RPC connection test failed: ${error.message}`);
            return {
                success: false,
                message: `RPC connection failed (${this.rpcTransport}): ${error.message}`,
                timestamp: new Date()
            };
        }
    }

    /**
     * 获取模拟租户配置（当RPC调用失败时使用）
     */
    private getMockTenantConfigs(): TenantConfig[] {
        return [
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
                settings: {
                    serverSettings: {
                        serverBaseAPI: 'https://simalfa.kineticcloud.cn/simalfaprod/api/v1',
                        companyID: 'TC',
                        userAccount: 'testuser',
                        password: 'testpass'
                    },
                    companyInfo: {
                        tel: "15888888888",
                        taxNo: "338888888888SMB",
                        drawer: "338888888888SMB",
                        address: "338888888888SMB",
                        bankName: "338888888888SMB",
                        bankAccount: "338888888888SMB",
                        companyName: "338888888888SMB"
                    }
                }
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
                settings: {
                    serverSettings: {
                        serverBaseAPI: 'https://demo.kineticcloud.cn/demoprod/api/v1',
                        companyID: 'DEMO',
                        userAccount: 'demouser',
                        password: 'demopass'
                    },
                    companyInfo: {
                        tel: "13999999999",
                        taxNo: "999999999999SMB",
                        drawer: "999999999999SMB",
                        address: "999999999999SMB",
                        bankName: "999999999999SMB",
                        bankAccount: "999999999999SMB",
                        companyName: "999999999999SMB"
                    }
                }
            }
        ];
    }

    /**
     * 获取默认配置（当RPC调用失败时使用）
     */
    private getDefaultConfig(): AppConfig {
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