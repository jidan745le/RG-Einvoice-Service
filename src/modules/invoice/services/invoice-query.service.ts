import { Injectable, Logger } from '@nestjs/common';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { InvoiceCacheService } from './invoice-cache.service';
import { EpicorService } from '../../epicor/epicor.service';
import { TenantConfigService } from '../../tenant/tenant-config.service';
import { EpicorTenantConfig } from '../../epicor/epicor.service';
import { EpicorInvoiceHeader } from '../../epicor/interfaces/epicor.interface';
import { EpicorInvoice } from '../../epicor/interfaces/epicor.interface';

@Injectable()
export class InvoiceQueryService {
    private readonly logger = new Logger(InvoiceQueryService.name);

    constructor(
        private readonly invoiceCacheService: InvoiceCacheService,
        private readonly epicorService: EpicorService,
        private readonly tenantConfigService: TenantConfigService,
    ) { }

    /**
     * 查询发票列表 - 智能选择数据源
     * 根据查询参数决定是使用本地缓存还是直接查询Epicor
     * @param queryDto 查询参数
     * @param tenantId 租户ID
     * @param authorization 授权头
     * @returns 发票列表和统计信息
     */
    async findAll(queryDto: QueryInvoiceDto, tenantId?: string, authorization?: string): Promise<{
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
        dataSource: 'cache' | 'epicor';
    }> {

        try {
            // 默认使用本地缓存查询
            this.logger.log('Querying from local cache');
            const result = await this.invoiceCacheService.findAllFromCache(queryDto, tenantId);
            return { ...result, dataSource: 'cache' };

        } catch (error) {
            this.logger.error(`Error in findAll: ${error.message}`, error.stack);

            // 如果缓存查询失败，尝试从Epicor查询作为回退


            throw error;
        }
    }


    // /**
    //  * 直接从Epicor查询发票数据
    //  * @param queryDto 查询参数
    //  * @param tenantId 租户ID
    //  * @param authorization 授权头
    //  * @returns 发票列表和统计信息
    //  */
    // private async queryFromEpicorDirect(
    //     queryDto: QueryInvoiceDto,
    //     tenantId?: string,
    //     authorization?: string
    // ): Promise<{
    //     items: Invoice[];
    //     total: number;
    //     page: number;
    //     limit: number;
    //     totals: {
    //         PENDING: number;
    //         SUBMITTED: number;
    //         ERROR: number;
    //         RED_NOTE: number;
    //         [key: string]: number;
    //     };
    // }> {
    //     const { page = 1, limit = 10, ...filters } = queryDto;

    //     if (!tenantId || !authorization) {
    //         throw new Error('Tenant ID and Authorization are required for fetching from Epicor.');
    //     }

    //     // 获取Epicor配置
    //     const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
    //     const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

    //     if (!serverSettings || !serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
    //         throw new Error('Epicor server configuration is incomplete.');
    //     }

    //     if (serverSettings.password === undefined) {
    //         serverSettings.password = '';
    //     }

    //     // 构建过滤条件
    //     const filterClauses: string[] = [];

    //     if (filters.erpInvoiceId) {
    //         const numValue = Number(filters.erpInvoiceId);
    //         if (!isNaN(numValue)) {
    //             filterClauses.push('InvcHead_InvoiceNum eq ' + numValue.toString());
    //         }
    //     }

    //     if (filters.customerName) {
    //         filterClauses.push(`substringof(Customer_Name, '${filters.customerName}')`);
    //     }

    //     if (filters.eInvoiceId) {
    //         filterClauses.push(`InvcHead_ELIEInvID eq '${filters.eInvoiceId}'`);
    //     }

    //     const formatDate = (dateInput: string | Date): string | null => {
    //         if (!dateInput) return null;
    //         try {
    //             const d = new Date(dateInput);
    //             if (isNaN(d.getTime())) return null;
    //             return d.toISOString().split('T')[0];
    //         } catch { return null; }
    //     };

    //     if (filters.startDate) {
    //         const formattedDate = formatDate(filters.startDate);
    //         if (formattedDate) {
    //             filterClauses.push(`OrderHed_OrderDate ge datetime'${formattedDate}'`);
    //         }
    //     }

    //     if (filters.endDate) {
    //         const formattedDate = formatDate(filters.endDate);
    //         if (formattedDate) {
    //             filterClauses.push(`OrderHed_OrderDate le datetime'${formattedDate}'`);
    //         }
    //     }

    //     if (filters.fapiaoType) {
    //         filterClauses.push(`InvcHead_CNTaxInvoiceType eq ${filters.fapiaoType}`);
    //     }

    //     if (filters.submittedBy) {
    //         filterClauses.push(`InvcHead_ELIEInvUpdatedBy eq '${filters.submittedBy}'`);
    //     }

    //     if (filters.invoiceComment) {
    //         filterClauses.push(`substringof(InvcHead_InvoiceComment, '${filters.invoiceComment}')`);
    //     }

    //     const odataFilterString = filterClauses.join(' and ');

    //     // 从Epicor获取数据 - 使用BAQ API
    //     const epicorData = await this.epicorService.fetchAllInvoicesFromBaq(
    //         serverSettings,
    //         {
    //             filter: odataFilterString,
    //             top: limit,
    //             skip: (page - 1) * limit,
    //             count: true
    //         }
    //     );

    //     const epicorInvoicesRaw = epicorData.value || [] as EpicorInvoice[];

    //     // 按发票号分组
    //     const groupedInvoices: Record<string, EpicorInvoice[]> = {};
    //     for (const invoice of epicorInvoicesRaw) {
    //         const invoiceNum = invoice.InvcHead_InvoiceNum.toString();
    //         if (!groupedInvoices[invoiceNum]) {
    //             groupedInvoices[invoiceNum] = [];
    //         }
    //         groupedInvoices[invoiceNum].push(invoice);
    //     }

    //     // 转换发票数据
    //     const transformedInvoices: Invoice[] = [];
    //     for (const invoiceNumStr in groupedInvoices) {
    //         const invoiceDetailsRaw = groupedInvoices[invoiceNumStr];
    //         const firstDetailRaw = invoiceDetailsRaw[0];

    //         const invoice = new Invoice();
    //         // 使用EpicorInvoice接口的正确字段映射
    //         invoice.postDate = firstDetailRaw.OrderHed_OrderDate ? new Date(firstDetailRaw.OrderHed_OrderDate) : null;
    //         invoice.id = firstDetailRaw.InvcHead_InvoiceNum;
    //         invoice.fapiaoType = firstDetailRaw.InvcHead_CNTaxInvoiceType?.toString() || '';
    //         invoice.customerName = firstDetailRaw.Customer_Name || '';
    //         invoice.invoiceAmount = 0; // EpicorInvoice doesn't have DocInvoiceAmt, calculate from details
    //         invoice.invoiceComment = firstDetailRaw.InvcHead_InvoiceComment || '';
    //         invoice.status = firstDetailRaw.InvcHead_ELIEInvStatus === 0 ? 'PENDING' :
    //             firstDetailRaw.InvcHead_ELIEInvStatus === 1 ? 'SUBMITTED' : 'ERROR';
    //         invoice.eInvoiceId = firstDetailRaw.InvcHead_ELIEInvID || null;
    //         invoice.hasPdf = !!firstDetailRaw.InvcHead_ELIEInvID;
    //         invoice.eInvoiceDate = firstDetailRaw.InvcHead_ELIEInvUpdatedOn ? new Date(firstDetailRaw.InvcHead_ELIEInvUpdatedOn) : null;
    //         invoice.submittedBy = firstDetailRaw.InvcHead_ELIEInvUpdatedBy || null;

    //         // 其他字段
    //         invoice.erpInvoiceId = firstDetailRaw.InvcHead_InvoiceNum;
    //         invoice.erpInvoiceDescription = firstDetailRaw.InvcHead_Description || '';
    //         invoice.customerResaleId = firstDetailRaw.Customer_ResaleID || '';
    //         invoice.orderNumber = firstDetailRaw.OrderHed_OrderNum?.toString() || '';
    //         invoice.orderDate = firstDetailRaw.OrderHed_OrderDate ? new Date(firstDetailRaw.OrderHed_OrderDate) : null;
    //         invoice.poNumber = firstDetailRaw.OrderHed_PONum || '';
    //         invoice.createdAt = firstDetailRaw.OrderHed_OrderDate ? new Date(firstDetailRaw.OrderHed_OrderDate) : new Date();
    //         invoice.updatedAt = firstDetailRaw.InvcHead_ELIEInvUpdatedOn ? new Date(firstDetailRaw.InvcHead_ELIEInvUpdatedOn) : new Date();

    //         // 映射发票明细 - EpicorInvoice是单个明细行，不像EpicorInvoiceHeader有InvcDtls数组
    //         invoice.invoiceDetails = invoiceDetailsRaw.map(detailRaw => {
    //             const detail = new InvoiceDetail();
    //             detail.erpInvoiceId = detailRaw.InvcDtl_InvoiceNum;
    //             detail.lineDescription = detailRaw.InvcDtl_LineDesc || '';
    //             detail.commodityCode = detailRaw.InvcDtl_CommodityCode || '';
    //             detail.salesUm = detailRaw.InvcDtl_SalesUM || '';
    //             detail.sellingShipQty = parseFloat(detailRaw.InvcDtl_SellingShipQty || "0") || 0;
    //             detail.uomDescription = detailRaw.UOMClass_Description || '';
    //             detail.docUnitPrice = parseFloat(detailRaw.InvcDtl_DocUnitPrice || "0") || 0;
    //             detail.docExtPrice = parseFloat(detailRaw.InvcDtl_DocExtPrice || "0") || 0;
    //             detail.taxPercent = parseFloat(detailRaw.InvcTax_Percent || "0") || 0;
    //             detail.id = parseInt(`${firstDetailRaw.InvcHead_InvoiceNum}${detailRaw.InvcDtl_InvoiceLine || Math.random().toString(36).substring(2, 8)}`, 36);
    //             detail.invoiceId = invoice.id;
    //             return detail;
    //         });

    //         // 计算发票总金额
    //         invoice.invoiceAmount = invoice.invoiceDetails.reduce((sum, detail) => sum + detail.docExtPrice, 0);

    //         transformedInvoices.push(invoice);
    //     }

    //     // 排序
    //     transformedInvoices.sort((a, b) => (b.orderDate?.getTime() || 0) - (a.orderDate?.getTime() || 0));

    //     const totalItems = epicorData['@odata.count'] !== undefined ? epicorData['@odata.count'] : transformedInvoices.length;

    //     return {
    //         items: transformedInvoices,
    //         total: totalItems,
    //         page,
    //         limit,
    //         totals: {
    //             PENDING: transformedInvoices.filter(invoice => invoice.status === 'PENDING').length,
    //             SUBMITTED: transformedInvoices.filter(invoice => invoice.status === 'SUBMITTED').length,
    //             ERROR: transformedInvoices.filter(invoice => invoice.status === 'ERROR').length,
    //             RED_NOTE: transformedInvoices.filter(invoice => invoice.status === 'RED_NOTE').length,
    //             TOTAL: totalItems,
    //         },
    //     };
    // }



    /**
     * 获取缓存统计信息
     * @returns 缓存统计
     */
    async getCacheStats(): Promise<any> {
        return this.invoiceCacheService.getCacheStats();
    }

    /**
     * 清理过期缓存
     * @param olderThanDays 清理多少天前的数据
     * @returns 清理结果
     */
    async cleanupOldCache(olderThanDays: number = 30): Promise<any> {
        return this.invoiceCacheService.cleanupOldCache(olderThanDays);
    }
} 