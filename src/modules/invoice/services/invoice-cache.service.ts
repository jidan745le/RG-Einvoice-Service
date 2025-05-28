import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { EpicorService } from '../../epicor/epicor.service';
import { TenantConfigService } from '../../tenant/tenant-config.service';
import { EpicorTenantConfig } from '../../epicor/epicor.service';
import { EpicorInvoice, EpicorResponse } from '../../epicor/interfaces/epicor.interface';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';

interface TenantEpicorConfig {
    tenantId: string;
    epicorTenantCompany: string;
    serverSettings: EpicorTenantConfig;
}

@Injectable()
export class InvoiceCacheService {
    private readonly logger = new Logger(InvoiceCacheService.name);

    constructor(
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        @InjectRepository(InvoiceDetail)
        private readonly invoiceDetailRepository: Repository<InvoiceDetail>,
        private readonly epicorService: EpicorService,
        private readonly tenantConfigService: TenantConfigService,
    ) { }

    /**
     * 增量同步服务 - 每3分钟执行一次
     * 从Epicor获取增量数据并更新本地缓存
     */
    @Cron('*/5 * * * *') // Every 5 minutes
    async performIncrementalSync(): Promise<void> {
        this.logger.log('Starting scheduled incremental sync from Epicor for all tenants');

        try {
            // 调用RPC接口获取拥有einvoice应用的所有租户配置
            const tenantConfigs = await this.getAllTenantEpicorConfigs();

            if (tenantConfigs.length === 0) {
                this.logger.warn('No tenant configurations found for einvoice application');
                return;
            }

            // 为每个租户执行增量同步
            const syncResults = await Promise.allSettled(
                tenantConfigs.map(config => this.syncIncrementalDataForTenant(config))
            );

            // 记录同步结果
            let successCount = 0;
            let failureCount = 0;

            syncResults.forEach((result, index) => {
                const tenantId = tenantConfigs[index].tenantId;
                if (result.status === 'fulfilled') {
                    successCount++;
                    this.logger.log(`Sync completed for tenant ${tenantId}: ${JSON.stringify(result.value)}`);
                } else {
                    failureCount++;
                    this.logger.error(`Sync failed for tenant ${tenantId}: ${result.reason}`);
                }
            });

            this.logger.log(`Scheduled sync completed. Success: ${successCount}, Failures: ${failureCount}`);

        } catch (error) {
            this.logger.error(`Error during scheduled sync: ${error.message}`, error.stack);
        }
    }

    /**
     * 获取所有租户的Epicor配置
     */
    private async getAllTenantEpicorConfigs(): Promise<TenantEpicorConfig[]> {
        try {
            // 调用RPC接口获取拥有einvoice应用的租户配置列表
            const tenantConfigs = await this.tenantConfigService.getTenantsByApplication('einvoice');

            const epicorConfigs: TenantEpicorConfig[] = [];

            for (const tenantConfig of tenantConfigs) {
                try {
                    // 新的数据结构已经包含了完整的配置信息
                    const serverSettings = tenantConfig.settings?.serverSettings;

                    if (!serverSettings) {
                        this.logger.warn(`No server settings found for tenant ${tenantConfig.tenantId}`);
                        continue;
                    }

                    if (!serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
                        this.logger.warn(`Incomplete server settings for tenant ${tenantConfig.tenantId}`);
                        continue;
                    }

                    // 确保password字段存在
                    if (serverSettings.password === undefined) {
                        serverSettings.password = '';
                    }

                    // 生成epicorTenantCompany标识
                    const epicorTenantCompany = this.generateEpicorTenantCompany(
                        serverSettings.serverBaseAPI,
                        serverSettings.companyID
                    );

                    epicorConfigs.push({
                        tenantId: tenantConfig.tenantId,
                        epicorTenantCompany,
                        serverSettings: serverSettings as EpicorTenantConfig
                    });

                } catch (error) {
                    this.logger.error(`Error processing config for tenant ${tenantConfig.tenantId}: ${error.message}`);
                }
            }

            return epicorConfigs;
        } catch (error) {
            this.logger.error(`Error getting tenant configurations: ${error.message}`, error.stack);
            return [];
        }
    }

    /**
     * 生成epicorTenantCompany标识
     * @param serverBaseAPI Epicor API地址
     * @param companyID 公司ID
     */
    private generateEpicorTenantCompany(serverBaseAPI: string, companyID: string): string {
        try {
            // 从API地址中提取环境标识
            // 例如: https://simalfa.kineticcloud.cn/simalfaprod/api/v1 -> simalfaprod
            const url = new URL(serverBaseAPI);
            const pathParts = url.pathname.split('/').filter(part => part.length > 0);
            const environment = pathParts.find(part => part !== 'api' && part !== 'v1') || 'default';

            return `${environment}_${companyID}`;
        } catch (error) {
            this.logger.warn(`Error parsing server API URL ${serverBaseAPI}: ${error.message}`);
            return `default_${companyID}`;
        }
    }

    /**
     * 为特定租户执行增量数据同步
     * @param tenantConfig 租户配置
     */
    private async syncIncrementalDataForTenant(tenantConfig: TenantEpicorConfig): Promise<any> {
        const { tenantId, epicorTenantCompany, serverSettings } = tenantConfig;

        try {
            // 获取该租户最后同步时间（基于数据库中该epicorTenantCompany的最新创建时间）
            const lastSync = await this.getLastSyncTimeForTenant(epicorTenantCompany);

            this.logger.log(`Starting incremental sync for tenant ${tenantId} (${epicorTenantCompany}) since: ${lastSync?.toISOString() || 'beginning'}`);

            // 构建增量查询过滤器
            const filterClauses: string[] = [];
            if (lastSync) {
                const formattedDate = lastSync.toISOString().split('T')[0];
                filterClauses.push(`InvcHead_InvoiceDate ge datetime'${formattedDate}'`);
            }

            const odataFilter = filterClauses.join(' and ');

            // 从Epicor获取增量数据
            const epicorData = await this.epicorService.fetchAllInvoicesFromBaq(
                serverSettings,
                {
                    filter: odataFilter,
                    top: 500 // 限制单次同步数量
                }
            ) as EpicorResponse;

            const epicorInvoices = epicorData.value || [] as EpicorInvoice[];

            if (epicorInvoices.length === 0) {
                this.logger.log(`No new data found for tenant ${tenantId} (${epicorTenantCompany})`);
                return { success: true, message: 'No new data', processed: 0, tenantId, epicorTenantCompany };
            }

            // 处理增量数据（只插入，不更新）
            const processedCount = await this.processIncrementalInvoices(epicorInvoices, epicorTenantCompany);

            this.logger.log(`Incremental sync completed for tenant ${tenantId} (${epicorTenantCompany}). Processed ${processedCount} invoices`);

            return {
                success: true,
                message: `Successfully processed ${processedCount} invoices`,
                processed: processedCount,
                tenantId,
                epicorTenantCompany
            };

        } catch (error) {
            this.logger.error(`Error during incremental sync for tenant ${tenantId}: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * 获取特定租户的最后同步时间
     * @param epicorTenantCompany 租户公司标识
     */
    private async getLastSyncTimeForTenant(epicorTenantCompany: string): Promise<Date | null> {
        const lastInvoice = await this.invoiceRepository.findOne({
            where: { epicorTenantCompany },
            order: { createdAt: 'DESC' },
        });

        return lastInvoice?.createdAt || null;
    }

    /**
     * 处理增量发票数据（只插入，不更新）
     * @param epicorInvoices Epicor发票数据
     * @param epicorTenantCompany 租户公司标识
     */
    private async processIncrementalInvoices(epicorInvoices: EpicorInvoice[], epicorTenantCompany: string): Promise<number> {
        let processedCount = 0;

        for (const epicorInvoice of epicorInvoices) {
            try {
                // 检查发票是否已存在（基于erpInvoiceId和epicorTenantCompany）
                const existingInvoice = await this.invoiceRepository.findOne({
                    where: {
                        erpInvoiceId: epicorInvoice.InvcHead_InvoiceNum,
                        epicorTenantCompany
                    }
                });

                if (existingInvoice) {
                    // 如果已存在，跳过（不更新）
                    this.logger.debug(`Invoice ${epicorInvoice.InvcHead_InvoiceNum} already exists for ${epicorTenantCompany}, skipping`);
                    continue;
                }

                // 创建新发票
                await this.createNewInvoiceFromEpicor(epicorInvoice, epicorTenantCompany);
                processedCount++;

            } catch (error) {
                this.logger.error(`Error processing invoice ${epicorInvoice.InvcHead_InvoiceNum} for ${epicorTenantCompany}: ${error.message}`);
            }
        }

        return processedCount;
    }

    /**
     * 从Epicor数据创建新发票
     * @param epicorInvoice Epicor发票数据
     * @param epicorTenantCompany 租户公司标识
     */
    private async createNewInvoiceFromEpicor(epicorInvoice: EpicorInvoice, epicorTenantCompany: string): Promise<Invoice> {
        const invoice = this.invoiceRepository.create({
            erpInvoiceId: epicorInvoice.InvcHead_InvoiceNum,
            erpInvoiceDescription: epicorInvoice.InvcHead_Description || '',
            fapiaoType: epicorInvoice.InvcHead_CNTaxInvoiceType?.toString() || '',
            customerName: epicorInvoice.Customer_Name || '',
            customerResaleId: epicorInvoice.Customer_ResaleID || '',
            invoiceComment: epicorInvoice.InvcHead_InvoiceComment || '',
            orderNumber: epicorInvoice.OrderHed_OrderNum?.toString() || '',
            orderDate: epicorInvoice.OrderHed_OrderDate ? new Date(epicorInvoice.OrderHed_OrderDate) : null,
            postDate: epicorInvoice.OrderHed_OrderDate ? new Date(epicorInvoice.OrderHed_OrderDate) : null,
            poNumber: epicorInvoice.OrderHed_PONum || '',
            invoiceAmount: 0, // Will be calculated from details
            status: epicorInvoice.InvcHead_ELIEInvStatus === 0 ? 'PENDING' :
                epicorInvoice.InvcHead_ELIEInvStatus === 1 ? 'SUBMITTED' : 'ERROR',
            eInvoiceId: epicorInvoice.InvcHead_ELIEInvID || null,
            submittedBy: epicorInvoice.InvcHead_ELIEInvUpdatedBy || null,
            eInvoiceDate: epicorInvoice.InvcHead_ELIEInvUpdatedOn ? new Date(epicorInvoice.InvcHead_ELIEInvUpdatedOn) : null,
            hasPdf: !!epicorInvoice.InvcHead_ELIEInvID,
            epicorTenantCompany, // 设置租户公司标识
        });

        const savedInvoice = await this.invoiceRepository.save(invoice);

        // Create invoice detail from the single EpicorInvoice record
        const invoiceDetail = this.invoiceDetailRepository.create({
            invoiceId: savedInvoice.id,
            erpInvoiceId: epicorInvoice.InvcDtl_InvoiceNum,
            lineDescription: epicorInvoice.InvcDtl_LineDesc || '',
            commodityCode: epicorInvoice.InvcDtl_CommodityCode || '',
            salesUm: epicorInvoice.InvcDtl_SalesUM || '',
            sellingShipQty: parseFloat(epicorInvoice.InvcDtl_SellingShipQty || '0') || 0,
            docUnitPrice: parseFloat(epicorInvoice.InvcDtl_DocUnitPrice || '0') || 0,
            docExtPrice: parseFloat(epicorInvoice.InvcDtl_DocExtPrice || '0') || 0,
            taxPercent: parseFloat(epicorInvoice.InvcTax_Percent || '0') || 0,
        });

        await this.invoiceDetailRepository.save(invoiceDetail);

        return savedInvoice;
    }

    // /**
    //  * 手动触发增量同步
    //  * @param tenantId 租户ID
    //  * @param authorization 授权头
    //  */
    // async triggerIncrementalSync(tenantId?: string, authorization?: string): Promise<any> {
    //     this.logger.log(`Manual incremental sync triggered for tenant: ${tenantId || 'all tenants'}`);

    //     if (tenantId && authorization) {
    //         // 为特定租户执行同步
    //         return this.syncIncrementalDataForSpecificTenant(tenantId, authorization);
    //     } else {
    //         // 为所有租户执行同步
    //         return this.performIncrementalSync();
    //     }
    // }

    /**
     * 为特定租户执行增量同步（使用授权头）
     * @param tenantId 租户ID
     * @param authorization 授权头
     */
    private async syncIncrementalDataForSpecificTenant(tenantId: string, authorization: string): Promise<any> {
        try {
            // 获取租户配置
            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

            if (!serverSettings) {
                this.logger.warn('No Epicor server settings available, skipping sync');
                return { success: false, message: 'No server settings available' };
            }

            if (serverSettings.password === undefined) {
                serverSettings.password = '';
            }

            const epicorTenantCompany = this.generateEpicorTenantCompany(
                serverSettings.serverBaseAPI,
                serverSettings.companyID
            );

            const tenantConfig: TenantEpicorConfig = {
                tenantId,
                epicorTenantCompany,
                serverSettings
            };

            return await this.syncIncrementalDataForTenant(tenantConfig);

        } catch (error) {
            this.logger.error(`Error during manual sync for tenant ${tenantId}: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * 从本地缓存查询发票列表
     * @param queryDto 查询参数
     * @returns 发票列表和统计信息
     */
    async findAllFromCache(queryDto: QueryInvoiceDto): Promise<{
        items: Invoice[];
        total: number;
        page: number;
        limit: number;
        totals: {
            PENDING: number;
            SUBMITTED: number;
            ERROR: number;
            RED_NOTE: number;
            [key: string]: number;
        };
    }> {
        const { page = 1, limit = 10, ...filters } = queryDto;

        // 构建查询条件
        const queryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
            .leftJoinAndSelect('invoice.invoiceDetails', 'details');

        // 应用过滤条件
        if (filters.erpInvoiceId) {
            queryBuilder.andWhere('invoice.erpInvoiceId = :erpInvoiceId', {
                erpInvoiceId: filters.erpInvoiceId
            });
        }

        if (filters.customerName) {
            queryBuilder.andWhere('invoice.customerName LIKE :customerName', {
                customerName: `%${filters.customerName}%`
            });
        }

        if (filters.status) {
            queryBuilder.andWhere('invoice.status = :status', { status: filters.status });
        }

        if (filters.eInvoiceId) {
            queryBuilder.andWhere('invoice.eInvoiceId = :eInvoiceId', {
                eInvoiceId: filters.eInvoiceId
            });
        }

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('invoice.orderDate BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        } else if (filters.startDate) {
            queryBuilder.andWhere('invoice.orderDate >= :startDate', {
                startDate: filters.startDate
            });
        } else if (filters.endDate) {
            queryBuilder.andWhere('invoice.orderDate <= :endDate', {
                endDate: filters.endDate
            });
        }

        if (filters.fapiaoType) {
            queryBuilder.andWhere('invoice.fapiaoType = :fapiaoType', {
                fapiaoType: filters.fapiaoType
            });
        }

        if (filters.submittedBy) {
            queryBuilder.andWhere('invoice.submittedBy = :submittedBy', {
                submittedBy: filters.submittedBy
            });
        }

        if (filters.invoiceComment) {
            queryBuilder.andWhere('invoice.invoiceComment LIKE :invoiceComment', {
                invoiceComment: `%${filters.invoiceComment}%`
            });
        }

        // 排序
        queryBuilder.orderBy('invoice.orderDate', 'DESC');

        // 获取总数
        const total = await queryBuilder.getCount();

        // 应用分页
        const items = await queryBuilder
            .skip((page - 1) * limit)
            .take(limit)
            .getMany();

        // 计算状态统计
        const statusCounts = await this.getStatusCounts(filters);

        return {
            items,
            total,
            page,
            limit,
            totals: statusCounts,
        };
    }

    /**
     * 获取状态统计
     * @param filters 过滤条件
     */
    private async getStatusCounts(filters: any): Promise<{
        PENDING: number;
        SUBMITTED: number;
        ERROR: number;
        RED_NOTE: number;
        [key: string]: number;
    }> {
        const queryBuilder = this.invoiceRepository.createQueryBuilder('invoice');

        // 应用相同的过滤条件（除了状态）
        if (filters.erpInvoiceId) {
            queryBuilder.andWhere('invoice.erpInvoiceId = :erpInvoiceId', {
                erpInvoiceId: filters.erpInvoiceId
            });
        }

        if (filters.customerName) {
            queryBuilder.andWhere('invoice.customerName LIKE :customerName', {
                customerName: `%${filters.customerName}%`
            });
        }

        if (filters.eInvoiceId) {
            queryBuilder.andWhere('invoice.eInvoiceId = :eInvoiceId', {
                eInvoiceId: filters.eInvoiceId
            });
        }

        if (filters.startDate && filters.endDate) {
            queryBuilder.andWhere('invoice.orderDate BETWEEN :startDate AND :endDate', {
                startDate: filters.startDate,
                endDate: filters.endDate,
            });
        } else if (filters.startDate) {
            queryBuilder.andWhere('invoice.orderDate >= :startDate', {
                startDate: filters.startDate
            });
        } else if (filters.endDate) {
            queryBuilder.andWhere('invoice.orderDate <= :endDate', {
                endDate: filters.endDate
            });
        }

        const results = await queryBuilder
            .select('invoice.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('invoice.status')
            .getRawMany();

        const totals = {
            PENDING: 0,
            SUBMITTED: 0,
            ERROR: 0,
            RED_NOTE: 0,
        };

        results.forEach(result => {
            totals[result.status] = parseInt(result.count);
        });

        return totals;
    }



    /**
     * 获取缓存统计信息
     */
    async getCacheStats(): Promise<{
        totalInvoices: number;
        totalDetails: number;
        statusDistribution: Record<string, number>;
        tenantDistribution: Record<string, number>;
        oldestInvoice: Date | null;
        newestInvoice: Date | null;
    }> {
        const totalInvoices = await this.invoiceRepository.count();
        const totalDetails = await this.invoiceDetailRepository.count();

        const statusResults = await this.invoiceRepository
            .createQueryBuilder()
            .select('status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('status')
            .getRawMany();

        const statusDistribution = {};
        statusResults.forEach(result => {
            statusDistribution[result.status] = parseInt(result.count);
        });

        // 获取租户分布统计
        const tenantResults = await this.invoiceRepository
            .createQueryBuilder()
            .select('epicorTenantCompany', 'tenant')
            .addSelect('COUNT(*)', 'count')
            .groupBy('epicorTenantCompany')
            .getRawMany();

        const tenantDistribution = {};
        tenantResults.forEach(result => {
            tenantDistribution[result.tenant || 'unknown'] = parseInt(result.count);
        });

        const oldestInvoice = await this.invoiceRepository.findOne({
            where: {},
            order: { createdAt: 'ASC' },
        });

        const newestInvoice = await this.invoiceRepository.findOne({
            where: {},
            order: { createdAt: 'DESC' },
        });

        return {
            totalInvoices,
            totalDetails,
            statusDistribution,
            tenantDistribution,
            oldestInvoice: oldestInvoice?.createdAt || null,
            newestInvoice: newestInvoice?.createdAt || null,
        };
    }

    /**
     * 清理过期缓存数据
     * @param olderThanDays 清理多少天前的数据
     */
    async cleanupOldCache(olderThanDays: number = 30): Promise<{
        deletedInvoices: number;
        deletedDetails: number;
    }> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        this.logger.log(`Cleaning up cache data older than ${olderThanDays} days (before ${cutoffDate.toISOString()})`);

        // 获取要删除的发票ID
        const invoicesToDelete = await this.invoiceRepository.find({
            where: {
                createdAt: LessThan(cutoffDate),
                status: 'SUBMITTED' // 只删除已提交的发票
            },
            select: ['id']
        });

        const invoiceIds = invoicesToDelete.map(inv => inv.id);

        let deletedDetails = 0;
        let deletedInvoices = 0;

        if (invoiceIds.length > 0) {
            // 删除明细
            const detailsResult = await this.invoiceDetailRepository
                .createQueryBuilder()
                .delete()
                .where('invoiceId IN (:...ids)', { ids: invoiceIds })
                .execute();

            deletedDetails = detailsResult.affected || 0;

            // 删除发票
            const invoicesResult = await this.invoiceRepository
                .createQueryBuilder()
                .delete()
                .where('id IN (:...ids)', { ids: invoiceIds })
                .execute();

            deletedInvoices = invoicesResult.affected || 0;
        }

        this.logger.log(`Cache cleanup completed. Deleted ${deletedInvoices} invoices and ${deletedDetails} details`);

        return { deletedInvoices, deletedDetails };
    }

    /**
     * 测试方法：获取所有租户配置（用于调试）
     */
    async testGetAllTenantConfigs(): Promise<any> {
        this.logger.log('Testing getAllTenantEpicorConfigs method');
        try {
            const configs = await this.getAllTenantEpicorConfigs();
            this.logger.log(`Found ${configs.length} tenant configurations:`);
            configs.forEach(config => {
                this.logger.log(`- Tenant: ${config.tenantId}, Company: ${config.epicorTenantCompany}, API: ${config.serverSettings.serverBaseAPI}`);
            });
            return {
                success: true,
                tenantCount: configs.length,
                configs: configs.map(config => ({
                    tenantId: config.tenantId,
                    epicorTenantCompany: config.epicorTenantCompany,
                    serverBaseAPI: config.serverSettings.serverBaseAPI,
                    companyID: config.serverSettings.companyID
                }))
            };
        } catch (error) {
            this.logger.error(`Error testing tenant configs: ${error.message}`, error.stack);
            return {
                success: false,
                error: error.message
            };
        }
    }
} 