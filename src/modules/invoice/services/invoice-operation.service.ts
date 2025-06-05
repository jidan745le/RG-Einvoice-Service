import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { BaiwangService } from '../../baiwang/baiwang.service';
import { EpicorService } from '../../epicor/epicor.service';
import { TenantConfigService } from '../../tenant/tenant-config.service';
import { EpicorTenantConfig } from '../../epicor/epicor.service';
import { AuthorizationCacheService } from '../authorization-cache.service';
import { v4 as uuidv4 } from 'uuid';
import { ELIEInvoiceResetOptions, ELIEInvoiceResetResult, EpicorInvoiceHeader } from '../../epicor/interfaces/epicor.interface';

@Injectable()
export class InvoiceOperationService {
    private readonly logger = new Logger(InvoiceOperationService.name);

    constructor(
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        @InjectRepository(InvoiceDetail)
        private readonly invoiceDetailRepository: Repository<InvoiceDetail>,
        private readonly baiwangService: BaiwangService,
        private readonly epicorService: EpicorService,
        private readonly tenantConfigService: TenantConfigService,
        private readonly authorizationCacheService: AuthorizationCacheService,
    ) { }

    private generateEpicorTenantCompany(serverBaseAPI: string, companyID: string): string {
        try {
            // 从API地址中提取环境标识
            // 例如: https://simalfa.kineticcloud.cn/simalfaprod/api/v1 -> simalfaprod
            const url = new URL(serverBaseAPI);
            const pathParts = url.pathname.split('/').filter(part => part.length > 0);
            const environment = pathParts.find(part => part !== 'api' && part !== 'v1' && part !== 'v2') || 'default';

            return `${environment}_${companyID}`;
        } catch (error) {
            this.logger.warn(`Error parsing server API URL ${serverBaseAPI}: ${error.message}`);
            return `default_${companyID}`;
        }
    }

    async batchResetELIEInvoiceFields(
        tenantId: string | undefined,
        authorization?: string
    ): Promise<ELIEInvoiceResetResult> {
        const appConfig = await this.tenantConfigService.getAppConfig(tenantId as string, 'einvoice', authorization);
        const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;
        return this.epicorService.batchResetELIEInvoiceFields(serverSettings);
    }

    /**
     * 构建 ELIEInvException JSON 数据
     * @param data JSON 数据对象
     * @returns JSON 字符串
     */
    private buildELIEInvExceptionJson(data: {
        status?: string;
        serialNo?: string;
        EInvRefNum?: string;
        eInvoicePdf?: string;
        comment?: string;
    }): string {
        try {
            return JSON.stringify(data);
        } catch (error) {
            this.logger.warn(`Error building ELIEInvException JSON: ${error.message}`);
            return JSON.stringify({ comment: data.comment || 'Error building JSON data' });
        }
    }

    /**
     * 提交发票到百望开票 - 操作服务
     * 1. 从Epicor获取实时发票数据
     * 2. 调用百望开票API
     * 3. 回写结果到Epicor
     * 4. 更新本地缓存状态
     * @param id 发票ID (ERP Invoice ID)
     * @param submittedBy 提交人
     * @param tenantId 租户ID
     * @param authorization 授权头
     * @returns 提交结果
     */
    async submitInvoice(id: number, submittedBy: string, tenantId: string = 'default', authorization?: string): Promise<any> {
        try {
            this.logger.log(`Starting invoice submission process for invoice ${id}`);

            // 1. 初始化百望服务，获取租户特定配置
            await this.baiwangService.initialize(tenantId, authorization);

            // 获取Epicor配置
            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

            if (!serverSettings || !serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
                this.logger.error('Epicor server settings are missing or incomplete from tenant configuration.');
                throw new Error('Epicor server configuration is incomplete.');
            }

            if (serverSettings.password === undefined) {
                serverSettings.password = '';
            }

            const company = appConfig?.settings?.serverSettings?.companyID;
            const serverBaseAPI = appConfig?.settings?.serverSettings?.serverBaseAPI;
            const epicorTenantCompany = this.generateEpicorTenantCompany(
                serverBaseAPI,
                company
            );

            // 2. 直接从Epicor API获取发票实时数据
            this.logger.log(`Fetching real-time invoice data from Epicor for invoice ${id}`);
            const epicorInvoiceData = await this.epicorService.getInvoiceById(serverSettings, id);

            if (!epicorInvoiceData) {
                throw new Error(`Invoice with ID ${id} not found in Epicor`);
            }

            // 获取公司信息配置
            const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

            // Generate order number using UUID (shortened) and include erpInvoiceId for easier retrieval in callback
            const orderNo = `ORD-${uuidv4().substring(0, 8)}-${id}`;

            // Store authorization for callback processing
            if (authorization) {
                this.authorizationCacheService.storeAuthorizationForCallback(orderNo, authorization, tenantId);
            } else {
                this.logger.warn(`No authorization provided for invoice ${id}, callback processing may fail`);
            }

            // Log cache stats
            const cacheStats = this.authorizationCacheService.getCacheStats();
            this.logger.log(`Authorization cache stats after storing: ${JSON.stringify(cacheStats)}`);

            // 3. Map invoice details to Baiwang format from Epicor data
            const invoiceDetailList = (epicorInvoiceData.InvcDtls || []).map(detail => ({
                goodsTaxRate: String((detail.TaxPercent ? parseFloat(String(detail.TaxPercent)) / 100 : 0.13).toFixed(2)),
                goodsTotalPrice: String(detail.DocExtPrice || '0'),
                goodsPrice: String(detail.DocUnitPrice || '0'),
                goodsQuantity: String(detail.SellingShipQty || '1'),
                goodsUnit: detail.SalesUM || '',
                goodsName: detail.LineDesc || 'Product',
            }));

            if (!invoiceDetailList.length) {
                throw new Error('Cannot submit invoice without details');
            }

            // Create Baiwang request
            const baiwangRequest = {
                buyerTelephone: '',
                priceTaxMark: '0',
                callBackUrl: 'https://einvoice-test.rg-experience.com/api/invoice/callback',
                invoiceDetailList,
                sellerAddress: companyInfo.address || 'Environment issue immediately',
                buyerAddress: 'Test address',
                buyerBankName: 'Test bank name',
                invoiceType: '1',
                taxNo: companyInfo.taxNo || '338888888888SMB',
                orderDateTime: new Date().toISOString().split('T')[0] + ' 10:00:00',
                orderNo,
                buyerName: epicorInvoiceData.CustomerName || 'Test Company',
                invoiceTypeCode: '02',
                sellerBankName: companyInfo.bankName || 'Test Bank',
                remarks: epicorInvoiceData.InvoiceComment || 'Invoice',
            };

            // 4. Submit to Baiwang
            this.logger.log(`Submitting invoice to Baiwang with orderNo: ${orderNo}`);
            const result = await this.baiwangService.submitInvoice(baiwangRequest);

            // 5. Update invoice status in Epicor directly no need
            // await this.epicorService.updateInvoiceStatus(serverSettings, id, {
            //     ELIEInvoice: true,
            //     ELIEInvStatus: 0, // 0 = PENDING
            //     ELIEInvUpdatedBy: submittedBy,
            //     ELIEInvException: '',
            //     ELIEInvUpdatedOn: new Date().toISOString(),
            //     EInvRefNum: orderNo,
            //     RowMod: 'U'
            // });

            // 6. Update local cache status (if the invoice exists in cache)
            try {
                const localInvoice = await this.invoiceRepository.findOne({
                    where: { erpInvoiceId: id, epicorTenantCompany: epicorTenantCompany }
                });

                this.logger.log(`Local invoice: ${JSON.stringify(localInvoice)}`, id);
                //不要处理 回调再处理
                // if (localInvoice) {
                //     await this.invoiceRepository.update(localInvoice.id, {
                //         status: 'PENDING',
                //         submittedBy,
                //         updatedAt: new Date(),
                //     });
                //     this.logger.log(`Updated local cache status for invoice ${id}`);
                // }
            } catch (cacheError) {
                this.logger.warn(`Failed to update local cache for invoice ${id}: ${cacheError.message}`);
                // Don't fail the operation if cache update fails
            }

            this.logger.log(`Invoice ${id} submitted successfully with orderNo: ${orderNo}`);

            return {
                success: true,
                message: 'Invoice submitted successfully',
                data: {
                    orderNo,
                    result,
                    erpInvoiceId: id,
                    status: 'PENDING'
                },
            };
        } catch (error) {
            this.logger.error(`Error submitting invoice ${id}: ${error.message}`, error.stack);

            // Try to update invoice status to ERROR in Epicor
            try {
                const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
                const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

                if (serverSettings) {
                    await this.epicorService.updateInvoiceStatus(serverSettings, id, {
                        ELIEInvoice: true,
                        ELIEInvUpdatedBy: submittedBy,
                        ELIEInvException: this.buildELIEInvExceptionJson({
                            status: 'ERROR',
                            comment: `Error: ${error.message}`
                        }),
                        ELIEInvUpdatedOn: new Date().toISOString(),
                        RowMod: 'U'
                    });
                }
            } catch (updateError) {
                this.logger.error(`Failed to update invoice status in Epicor: ${updateError.message}`);
            }

            // Update local cache to ERROR status if it exists
            try {
                const localInvoice = await this.invoiceRepository.findOne({
                    where: { erpInvoiceId: id }
                });

                if (localInvoice) {
                    await this.invoiceRepository.update(localInvoice.id, {
                        status: 'ERROR',
                        comment: `Error: ${error.message}`,
                        updatedAt: new Date(),
                    });
                }
            } catch (cacheError) {
                this.logger.warn(`Failed to update local cache error status for invoice ${id}: ${cacheError.message}`);
            }

            throw error;
        }
    }

    /**
     * 合并发票并提交到百望
     * 使用并行获取数据，验证合并条件，调用百望合并开票，并行回写状态
     * @param mergeDto 包含要合并的发票ID和提交人
     * @param tenantId 租户ID
     * @param authorization Authorization header
     * @returns 合并结果
     */
    async mergeAndSubmitInvoices(mergeDto: { erpInvoiceIds: number[]; submittedBy: string }, tenantId: string = 'default', authorization?: string): Promise<any> {
        try {
            const { erpInvoiceIds, submittedBy } = mergeDto;
            this.logger.log(`Starting merge operation for invoices: ${erpInvoiceIds.join(', ')} by ${submittedBy}`);

            // 初始化百望服务，获取租户特定配置
            await this.baiwangService.initialize(tenantId, authorization);

            // 获取公司信息配置
            const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

            // 获取Epicor配置
            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

            if (!serverSettings || !serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
                this.logger.error('Epicor server settings are missing or incomplete from tenant configuration.');
                throw new Error('Epicor server configuration is incomplete.');
            }

            if (serverSettings.password === undefined) {
                serverSettings.password = '';
            }

            if (!erpInvoiceIds.length) {
                throw new Error('At least one invoice ID must be provided');
            }

            // 并行获取所有发票数据
            this.logger.log(`Fetching invoice data for ${erpInvoiceIds.length} invoices in parallel`);
            const invoicePromises = erpInvoiceIds.map(id =>
                this.epicorService.getInvoiceById(serverSettings, id)
                    .catch(error => {
                        this.logger.error(`Failed to fetch invoice ${id}: ${error.message}`);
                        return null;
                    })
            );

            const invoicesData = await Promise.all(invoicePromises);

            // 过滤掉获取失败的发票
            const validInvoices = invoicesData.filter((invoice, index) => {
                if (!invoice) {
                    this.logger.warn(`Invoice ${erpInvoiceIds[index]} not found or failed to fetch`);
                    return false;
                }
                return true;
            }) as EpicorInvoiceHeader[];

            if (validInvoices.length === 0) {
                throw new Error('No valid invoices found for merging');
            }

            if (validInvoices.length !== erpInvoiceIds.length) {
                const foundIds = validInvoices.map(inv => inv.InvoiceNum);
                const missingIds = erpInvoiceIds.filter(id => !foundIds.includes(id));
                throw new Error(`Some invoices were not found: ${missingIds.join(', ')}`);
            }

            // 验证合并条件
            const firstCustomer = validInvoices[0].CustomerName;
            const firstCustomerNum = validInvoices[0].CustNum;
            for (const invoice of validInvoices) {
                if (invoice.CustomerName !== firstCustomer) {
                    throw new Error(`All invoices must be from the same customer. Expected ${firstCustomer}, got ${invoice.CustomerName}`);
                }
                if (invoice.CustNum !== firstCustomerNum) {
                    throw new Error(`All invoices must have the same customer number. Expected ${firstCustomerNum}, got ${invoice.CustNum}`);
                }
                // Check if invoice has already been submitted (ELIEInvStatus = 1)
                if (invoice.ELIEInvStatus === 1) {
                    throw new Error(`Invoice with ID ${invoice.InvoiceNum} has already been submitted`);
                }
            }

            // 收集所有发票明细并合并类似商品行
            let allDetails: any[] = [];
            for (const invoice of validInvoices) {
                if (invoice.InvcDtls && invoice.InvcDtls.length > 0) {
                    allDetails = [...allDetails, ...invoice.InvcDtls];
                }
            }

            if (!allDetails.length) {
                throw new Error('No invoice details found for the selected invoices');
            }

            // 合并类似商品行
            const mergedItems = this.mergeInvoiceDetails(allDetails);

            // 计算合并后的总金额
            const totalAmount = mergedItems.reduce((sum, item) => sum + Number(item.goodsTotalPrice), 0);

            // 生成订单号，包含所有发票ID以便回调时识别
            const orderNo = `MERGE-${uuidv4().substring(0, 8)}-${erpInvoiceIds.join('-')}`;

            // Store authorization for callback processing
            if (authorization) {
                this.authorizationCacheService.storeAuthorizationForCallback(orderNo, authorization, tenantId);
            } else {
                this.logger.warn(`No authorization provided for merged invoices ${erpInvoiceIds.join(', ')}, callback processing may fail`);
            }

            // 创建百望请求
            const baiwangRequest = {
                buyerTelephone: '',
                priceTaxMark: '0',
                callBackUrl: 'https://einvoice-test.rg-experience.com/api/invoice/callback',
                invoiceDetailList: mergedItems,
                sellerAddress: companyInfo.address || 'Environment issue immediately',
                buyerAddress: 'Test address',
                buyerBankName: 'Test bank name',
                invoiceType: '1',
                taxNo: companyInfo.taxNo || '338888888888SMB',
                orderDateTime: new Date().toISOString().split('T')[0] + ' 10:00:00',
                orderNo,
                buyerName: firstCustomer || 'Test Company',
                invoiceTypeCode: '02',
                sellerBankName: companyInfo.bankName || 'Test Bank',
                remarks: `Merged invoice for ${erpInvoiceIds.join(', ')}`,
            };

            // 提交到百望
            this.logger.log(`Submitting merged invoices to Baiwang with orderNo: ${orderNo}`);
            const result = await this.baiwangService.submitInvoice(baiwangRequest);

            // 并行更新所有发票状态在Epicor中
            // const updatePromises = validInvoices.map(invoice =>
            //     this.epicorService.updateInvoiceStatus(serverSettings, invoice.InvoiceNum, {
            //         ELIEInvoice: true,
            //         ELIEInvStatus: 0, // 0 = PENDING
            //         ELIEInvUpdatedBy: submittedBy,
            //         ELIEInvException: this.buildELIEInvExceptionJson({
            //             status: 'PENDING',
            //             EInvRefNum: orderNo,
            //             comment: `Merged with invoices: ${erpInvoiceIds.filter(id => id !== invoice.InvoiceNum).join(', ')}`
            //         }),
            //         ELIEInvUpdatedOn: new Date().toISOString(),
            //         EInvRefNum: orderNo,
            //         RowMod: 'U'
            //     }).catch(error => {
            //         this.logger.error(`Could not update invoice ${invoice.InvoiceNum} status in Epicor: ${error.message}`);
            //         return null;
            //     })
            // );

            // 并行更新本地缓存状态
            // const localUpdatePromises = erpInvoiceIds.map(async (id) => {
            //     try {
            //         const localInvoice = await this.invoiceRepository.findOne({
            //             where: { erpInvoiceId: id }
            //         });

            //         if (localInvoice) {
            //             await this.invoiceRepository.update(localInvoice.id, {
            //                 status: 'PENDING',
            //                 submittedBy,
            //                 orderNumber: orderNo,
            //                 comment: `Merged with invoices: ${erpInvoiceIds.filter(otherId => otherId !== id).join(', ')}`,
            //                 updatedAt: new Date(),
            //             });
            //         }
            //     } catch (error) {
            //         this.logger.warn(`Failed to update local cache for invoice ${id}: ${error.message}`);
            //     }
            // });

            // // 等待所有更新完成
            // await Promise.all([...updatePromises, ...localUpdatePromises]);

            // this.logger.log(`Successfully merged and submitted ${erpInvoiceIds.length} invoices with orderNo: ${orderNo}`);

            return {
                success: true,
                message: 'Invoices merged and submitted successfully',
                data: {
                    mergedInvoiceIds: erpInvoiceIds,
                    orderNo,
                    totalAmount,
                    result
                },
            };
        } catch (error) {
            this.logger.error(`Error merging invoices: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * 合并类似的发票明细行
     * @param details 发票明细列表
     * @returns 合并后的百望发票明细列表
     */
    private mergeInvoiceDetails(details: any[]): any[] {
        // 用于存储合并后的商品行，键为商品代码+单价+税率
        const mergedMap: Record<string, any> = {};

        for (const detail of details) {
            // 创建唯一键
            const key = `${detail.CommodityCode || ''}-${detail.DocUnitPrice || 0}-${detail.TaxPercent || 0}`;

            if (!mergedMap[key]) {
                // 如果这个商品行还没有合并过，创建一个新的
                mergedMap[key] = {
                    goodsTaxRate: String((detail.TaxPercent ? parseFloat(String(detail.TaxPercent)) / 100 : 0.13).toFixed(2)),
                    goodsTotalPrice: String(detail.DocExtPrice || '0'),
                    goodsPrice: String(detail.DocUnitPrice || '0'),
                    goodsQuantity: String(detail.SellingShipQty || '1'),
                    goodsUnit: detail.SalesUM || '',
                    goodsName: detail.LineDesc || 'Product',
                    _originalQuantity: parseFloat(String(detail.SellingShipQty)) || 1,
                    _originalTotal: parseFloat(String(detail.DocExtPrice)) || 0,
                };
            } else {
                // 如果已经有了，增加数量和总价
                const currentItem = mergedMap[key];
                const additionalQty = parseFloat(String(detail.SellingShipQty)) || 1;
                const additionalTotal = parseFloat(String(detail.DocExtPrice)) || 0;

                currentItem._originalQuantity += additionalQty;
                currentItem._originalTotal += additionalTotal;

                // 更新百望需要的字段
                currentItem.goodsQuantity = String(currentItem._originalQuantity);
                currentItem.goodsTotalPrice = String(currentItem._originalTotal.toFixed(2));
            }
        }

        // 转换为数组并移除内部使用的临时字段
        return Object.values(mergedMap).map(item => {
            const { _originalQuantity, _originalTotal, ...rest } = item;
            return rest;
        });
    }

    /**
     * 查找单个发票
     * @param id 发票ID (ERP Invoice ID)
     * @returns 发票详情
     */
    async findOne(id: number): Promise<Invoice> {
        const invoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId: id },
            relations: ['invoiceDetails']
        });

        if (!invoice) {
            throw new NotFoundException(`Invoice with ID ${id} not found`);
        }

        return invoice;
    }

    /**
     * 根据ERP发票ID查找发票
     * @param erpInvoiceId ERP发票ID
     * @returns 发票详情
     */
    async findByErpInvoiceId(erpInvoiceId: number): Promise<Invoice> {
        const invoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId },
            relations: ['invoiceDetails']
        });

        if (!invoice) {
            throw new NotFoundException(`Invoice with ERP ID ${erpInvoiceId} not found`);
        }

        return invoice;
    }

    /**
     * Process callback from Baiwang after invoice is issued
     * @param callbackData Callback data from Baiwang
     * @returns Process result
     */
    async processCallback(callbackData: any): Promise<any> {
        this.logger.log(`Processing callback: ${JSON.stringify(callbackData)}`);

        try {
            // Parse callback data
            const callbackJson = typeof callbackData === 'string' ? JSON.parse(callbackData) : callbackData;
            const data = typeof callbackJson.data === 'string' ? JSON.parse(callbackJson.data) : callbackJson.data;

            // 检查是否是合并发票的回调
            const orderNo = data.orderNo;
            if (orderNo && orderNo.startsWith('MERGE-')) {
                return this.processMergedInvoiceCallback(callbackData);
            }

            // Check if it's a successful invoice
            if (data.status === '01') { // 01 represents success
                // Find the invoice using orderNo which contains the ERP invoice ID
                const orderNo = data.orderNo;

                // Extract the erpInvoiceId if it's included in the orderNo
                let erpInvoiceId: number | undefined = undefined;
                if (orderNo) {
                    try {
                        this.logger.log(`Attempting to extract erpInvoiceId from orderNo: ${orderNo}`);
                        // Extract erpInvoiceId from simplified format: ORD-{shortUuid}-{invoiceId}
                        const match = orderNo.match(/ORD-[a-f0-9]+-(\d+)$/);
                        if (match && match[1]) {
                            erpInvoiceId = parseInt(match[1], 10);
                            this.logger.log(`Successfully extracted erpInvoiceId: ${erpInvoiceId} from orderNo: ${orderNo}`);
                        } else {
                            this.logger.warn(`Regex match failed for orderNo: ${orderNo}. Match result: ${JSON.stringify(match)}`);
                        }
                    } catch (error) {
                        this.logger.warn(`Could not extract erpInvoiceId from orderNo: ${orderNo}. Error: ${error.message}`);
                    }
                }

                if (!erpInvoiceId) {
                    throw new Error(`Could not extract erpInvoiceId from orderNo: ${orderNo}`);
                }

                this.logger.log(`erpInvoiceId: ${erpInvoiceId}`);
                this.logger.log(`orderNo: ${orderNo}`);

                // Log cache stats instead of trying to stringify the Map
                const cacheStats = this.authorizationCacheService.getCacheStats();
                this.logger.log(`Authorization cache stats: ${JSON.stringify(cacheStats)}`);

                // Get Epicor configuration using cached authorization from submit time
                // Extract orderNo to get cached authorization and tenant info
                const cachedAuth = this.authorizationCacheService.getAuthorizationForCallback(orderNo);

                if (!cachedAuth) {
                    this.logger.error(`No cached authorization found for orderNo: ${orderNo}`);

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to missing authorization',
                        data: {
                            erpInvoiceId,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: 'Epicor update skipped - no cached authorization found'
                        }
                    };
                }

                const { authorization: cachedAuthorization, tenantId } = cachedAuth;
                this.logger.log(`Using cached authorization for tenant: ${tenantId}`);

                let appConfig;
                let serverSettings: EpicorTenantConfig | undefined;

                try {
                    // Use the cached authorization from submit time
                    appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', cachedAuthorization);
                    serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;
                } catch (configError) {
                    this.logger.error(`Failed to get app config with cached authorization: ${configError.message}`);

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to configuration error',
                        data: {
                            erpInvoiceId,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: `Epicor update skipped - configuration error: ${configError.message}`
                        }
                    };
                }

                if (!serverSettings) {
                    this.logger.error('Epicor server configuration not found in app config');

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to missing server settings',
                        data: {
                            erpInvoiceId,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: 'Epicor update skipped - server settings not found'
                        }
                    };
                }

                if (serverSettings.password === undefined) {
                    serverSettings.password = '';
                }

                try {
                    // Update invoice with e-invoice information in Epicor FIRST
                    await this.epicorService.updateInvoiceStatus(serverSettings, erpInvoiceId, {
                        ELIEInvoice: true,
                        // ELIEInvStatus: 1, // 1 = SUBMITTED/SUCCESS
                        ELIEInvUpdatedBy: data.drawer || 'system',
                        ELIEInvException: this.buildELIEInvExceptionJson({
                            status: 'SUBMITTED',
                            serialNo: data.serialNo,
                            EInvRefNum: orderNo,
                            eInvoicePdf: data.pdfUrl,
                            comment: `E-Invoice issued successfully: ${data.statusMessage}`
                        }),
                        ELIEInvUpdatedOn: data.invoiceTime ? new Date(data.invoiceTime).toISOString() : new Date().toISOString(),
                        ELIEInvID: data.digitInvoiceNo, // Use digitInvoiceNo as E-Invoice ID
                        RowMod: 'U'
                    });

                    this.logger.log(`Successfully updated invoice ${erpInvoiceId} status in Epicor via callback`);

                    // Only update local database AFTER successful Epicor update
                    try {
                        const localInvoice = await this.invoiceRepository.findOne({
                            where: { erpInvoiceId }
                        });

                        if (localInvoice) {
                            await this.invoiceRepository.update(localInvoice.id, {
                                status: 'SUBMITTED',
                                eInvoiceId: data.digitInvoiceNo,
                                serialNo: data.serialNo,
                                orderNumber: orderNo,
                                comment: `E-Invoice issued successfully: ${data.statusMessage}`,
                                updatedAt: new Date(),
                                eInvoicePdf: data.pdfUrl, // PDF URL
                                digitInvoiceNo: data.digitInvoiceNo,
                                eInvoiceDate: new Date(data.invoiceTime), // Invoice time as E-Invoice Date
                                submittedBy: data.drawer || 'system',
                            });
                            this.logger.log(`Updated local cache status for invoice ${erpInvoiceId} after successful Epicor update`);
                        }
                    } catch (cacheError) {
                        this.logger.warn(`Failed to update local cache for invoice ${erpInvoiceId}: ${cacheError.message}`);
                        // Don't fail the operation if cache update fails
                    }

                } catch (updateError) {
                    this.logger.error(`Failed to update invoice ${erpInvoiceId} in Epicor: ${updateError.message}`, updateError.stack);

                    // Still return success for the callback processing, but note the Epicor update failure
                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update failed',
                        data: {
                            erpInvoiceId,
                            status: 'SUBMITTED',
                            eInvoiceId: data.digitInvoiceNo,
                            orderNo,
                            warning: `Epicor update failed: ${updateError.message}`
                        }
                    };
                }

                return {
                    success: true,
                    message: 'Invoice updated successfully',
                    data: {
                        erpInvoiceId,
                        status: 'SUBMITTED',
                        eInvoiceId: data.digitInvoiceNo,
                        orderNo
                    }
                };
            } else {
                // Handle error or other status
                this.logger.warn(`Received non-success status: ${data.status} - ${data.statusMessage}`);

                // Try to extract erpInvoiceId from orderNo
                let erpInvoiceId: number | undefined = undefined;
                if (data.orderNo) {
                    try {
                        this.logger.log(`Attempting to extract erpInvoiceId from orderNo: ${data.orderNo}`);
                        // Extract erpInvoiceId from simplified format: ORD-{shortUuid}-{invoiceId}
                        const match = data.orderNo.match(/ORD-[a-f0-9]+-(\d+)$/);
                        if (match && match[1]) {
                            erpInvoiceId = parseInt(match[1], 10);
                            this.logger.log(`Successfully extracted erpInvoiceId: ${erpInvoiceId} from orderNo: ${data.orderNo}`);
                        } else {
                            this.logger.warn(`Regex match failed for orderNo: ${data.orderNo}. Match result: ${JSON.stringify(match)}`);
                        }
                    } catch (error) {
                        this.logger.warn(`Could not extract erpInvoiceId from orderNo: ${data.orderNo}. Error: ${error.message}`);
                    }
                }

                if (erpInvoiceId) {
                    // Get Epicor configuration using cached authorization
                    const cachedAuth = this.authorizationCacheService.getAuthorizationForCallback(data.orderNo);

                    if (!cachedAuth) {
                        this.logger.warn(`No cached authorization found for error callback orderNo: ${data.orderNo}`);

                        return {
                            success: false,
                            message: 'Invoice status update failed',
                            error: data.statusMessage || data.errorMessage || 'Unknown error'
                        };
                    }

                    const { authorization: cachedAuthorization, tenantId } = cachedAuth;

                    try {
                        const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', cachedAuthorization);
                        const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

                        if (serverSettings) {
                            if (serverSettings.password === undefined) {
                                serverSettings.password = '';
                            }

                            // Update Epicor FIRST
                            await this.epicorService.updateInvoiceStatus(serverSettings, erpInvoiceId, {
                                ELIEInvoice: true,
                                ELIEInvStatus: 2, // 2 = ERROR
                                ELIEInvUpdatedBy: 'system',
                                ELIEInvException: this.buildELIEInvExceptionJson({
                                    status: 'ERROR',
                                    comment: `E-Invoice error: ${data.statusMessage}`,
                                    EInvRefNum: data.orderNo,
                                }),
                                ELIEInvUpdatedOn: new Date().toISOString(),
                                RowMod: 'U'
                            });

                            this.logger.log(`Successfully updated invoice ${erpInvoiceId} with error status in Epicor via callback`);

                            // Only update local database AFTER successful Epicor update
                            try {
                                const localInvoice = await this.invoiceRepository.findOne({
                                    where: { erpInvoiceId }
                                });

                                if (localInvoice) {
                                    await this.invoiceRepository.update(localInvoice.id, {
                                        status: 'ERROR',
                                        comment: `E-Invoice error: ${data.statusMessage}`,
                                        updatedAt: new Date(),
                                    });
                                    this.logger.log(`Updated local cache error status for invoice ${erpInvoiceId} after successful Epicor update`);
                                }
                            } catch (cacheError) {
                                this.logger.warn(`Failed to update local cache error status for invoice ${erpInvoiceId}: ${cacheError.message}`);
                            }
                        }
                    } catch (configOrUpdateError) {
                        this.logger.warn(`Failed to update invoice ${erpInvoiceId} with error status in Epicor: ${configOrUpdateError.message}`);
                    }
                } else {
                    this.logger.warn('Could not extract erpInvoiceId from error callback, skipping Epicor update');
                }

                return {
                    success: false,
                    message: 'Error processing callback',
                    error: data.statusMessage
                };
            }
        } catch (error) {
            this.logger.error(`Error processing callback: ${error.message}`, error.stack);
            return {
                success: false,
                message: 'Error processing callback',
                error: error.message
            };
        }
    }

    /**
     * 处理合并发票的回调数据
     * @param callbackData 百望回调数据
     * @returns 处理结果
     */
    async processMergedInvoiceCallback(callbackData: any): Promise<any> {
        this.logger.log(`Processing merged invoice callback: ${JSON.stringify(callbackData)}`);

        try {
            // 解析回调数据
            const callbackJson = typeof callbackData === 'string' ? JSON.parse(callbackData) : callbackData;
            const data = typeof callbackJson.data === 'string' ? JSON.parse(callbackJson.data) : callbackJson.data;

            // 检查是否成功开具发票
            if (data.status === '01') { // 01表示成功
                // 使用orderNo查找发票
                const orderNo = data.orderNo;

                // 从orderNo中提取所有的erpInvoiceId with simplified format
                let erpInvoiceIds: number[] = [];
                try {
                    // Extract invoice IDs from simplified format: MERGE-{shortUuid}-{invoiceIds}
                    const match = orderNo.match(/MERGE-[a-f0-9]+-(.+)$/);
                    if (match && match[1]) {
                        erpInvoiceIds = match[1].split('-').map(id => parseInt(id, 10));
                    }
                } catch (error) {
                    this.logger.warn(`Could not extract erpInvoiceIds from : ${orderNo}`);
                    throw new Error(`Could not parse order number: ${orderNo}`);
                }

                if (!erpInvoiceIds.length) {
                    throw new Error(`No invoice IDs found in order number: ${orderNo}`);
                }

                // Get Epicor configuration using cached authorization from submit time
                // Extract orderNo to get cached authorization and tenant info
                const cachedAuth = this.authorizationCacheService.getAuthorizationForCallback(orderNo);

                if (!cachedAuth) {
                    this.logger.error(`No cached authorization found for orderNo: ${orderNo}`);

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to missing authorization',
                        data: {
                            erpInvoiceIds,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: 'Epicor update skipped - no cached authorization found'
                        }
                    };
                }

                const { authorization: cachedAuthorization, tenantId } = cachedAuth;
                this.logger.log(`Using cached authorization for tenant: ${tenantId}`);

                let appConfig;
                let serverSettings: EpicorTenantConfig | undefined;

                try {
                    // Use the cached authorization from submit time
                    appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', cachedAuthorization);
                    serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;
                } catch (configError) {
                    this.logger.error(`Failed to get app config with cached authorization: ${configError.message}`);

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to configuration error',
                        data: {
                            erpInvoiceIds,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: `Epicor update skipped - configuration error: ${configError.message}`
                        }
                    };
                }

                if (!serverSettings) {
                    this.logger.error('Epicor server configuration not found in app config');

                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update skipped due to missing server settings',
                        data: {
                            erpInvoiceIds,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: 'Epicor update skipped - server settings not found'
                        }
                    };
                }

                if (serverSettings.password === undefined) {
                    serverSettings.password = '';
                }

                let epicorUpdateSuccessful = true;
                const epicorUpdateResults: { id: number; success: boolean; error?: string }[] = [];

                try {
                    // 更新所有发票的电子发票信息在Epicor中 FIRST
                    for (const id of erpInvoiceIds) {
                        try {
                            await this.epicorService.updateInvoiceStatus(serverSettings, id, {
                                ELIEInvoice: true,
                                ELIEInvUpdatedBy: data.drawer || 'system',
                                ELIEInvException: this.buildELIEInvExceptionJson({
                                    status: 'SUBMITTED',
                                    serialNo: data.serialNo,
                                    EInvRefNum: orderNo,
                                    eInvoicePdf: data.pdfUrl,
                                    comment: `E-Invoice issued successfully for merged invoices: ${erpInvoiceIds.join(', ')}`,
                                }),
                                ELIEInvUpdatedOn: data.invoiceTime ? new Date(data.invoiceTime).toISOString() : new Date().toISOString(),
                                ELIEInvID: data.digitInvoiceNo, // Use digitInvoiceNo as E-Invoice ID
                                RowMod: 'U'
                            });

                            this.logger.log(`Successfully updated invoice ${id} status in Epicor via callback`);
                            epicorUpdateResults.push({ id, success: true });
                        } catch (error) {
                            this.logger.error(`Could not update invoice with ID ${id} in Epicor: ${error.message}`);
                            epicorUpdateResults.push({ id, success: false, error: error.message });
                            epicorUpdateSuccessful = false;
                        }
                    }

                    // Only update local database AFTER Epicor updates
                    if (epicorUpdateSuccessful) {
                        // Update local cache for all successfully updated invoices
                        for (const result of epicorUpdateResults) {
                            if (result.success) {
                                try {
                                    const localInvoice = await this.invoiceRepository.findOne({
                                        where: { erpInvoiceId: result.id }
                                    });

                                    if (localInvoice) {
                                        await this.invoiceRepository.update(localInvoice.id, {
                                            status: 'SUBMITTED',
                                            eInvoiceId: data.digitInvoiceNo,
                                            digitInvoiceNo: data.digitInvoiceNo,
                                            orderNumber: orderNo,
                                            serialNo: data.serialNo,
                                            comment: `E-Invoice issued successfully for merged invoices: ${erpInvoiceIds.join(', ')}`,
                                            updatedAt: new Date(),
                                            eInvoicePdf: data.pdfUrl, // PDF URL
                                            eInvoiceDate: new Date(data.invoiceTime), // Invoice time as E-Invoice Date
                                            submittedBy: data.drawer || 'system',
                                        });
                                        this.logger.log(`Updated local cache status for invoice ${result.id} after successful Epicor update`);
                                    }
                                } catch (cacheError) {
                                    this.logger.warn(`Failed to update local cache for invoice ${result.id}: ${cacheError.message}`);
                                }
                            }
                        }
                    }

                } catch (updateError) {
                    this.logger.error(`Failed to update invoices in Epicor: ${updateError.message}`, updateError.stack);

                    // Still return success for the callback processing, but note the Epicor update failure
                    return {
                        success: true,
                        message: 'Invoice callback processed but Epicor update failed',
                        data: {
                            erpInvoiceIds,
                            status: 'SUBMITTED',
                            eInvoiceId: data.serialNo,
                            orderNo,
                            warning: `Epicor update failed: ${updateError.message}`
                        }
                    };
                }

                return {
                    success: true,
                    message: 'Merged invoices updated successfully',
                    data: {
                        erpInvoiceIds,
                        status: 'SUBMITTED',
                        eInvoiceId: data.serialNo,
                        orderNo,
                        epicorUpdateResults
                    }
                };
            } else {
                // 处理失败情况
                this.logger.error(`Error processing callback: ${data.statusMessage}`);

                // 尝试从orderNo中提取所有的erpInvoiceId
                const orderNo = data.orderNo;
                if (orderNo && orderNo.startsWith('MERGE-')) {
                    let erpInvoiceIds: number[] = [];
                    try {
                        // Extract invoice IDs from simplified format: MERGE-{shortUuid}-{invoiceIds}
                        const match = orderNo.match(/MERGE-[a-f0-9]+-(.+)$/);
                        if (match && match[1]) {
                            erpInvoiceIds = match[1].split('-').map(id => parseInt(id, 10));
                        }
                    } catch (error) {
                        this.logger.warn(`Could not extract erpInvoiceIds from : ${orderNo}`);
                    }

                    // 更新所有相关发票的状态在Epicor中
                    if (erpInvoiceIds.length) {
                        // Get Epicor configuration using cached authorization
                        const cachedAuth = this.authorizationCacheService.getAuthorizationForCallback(orderNo);

                        if (!cachedAuth) {
                            this.logger.warn(`No cached authorization found for error callback orderNo: ${orderNo}`);

                            return {
                                success: false,
                                message: 'Invoice status update failed',
                                error: data.statusMessage || data.errorMessage || 'Unknown error'
                            };
                        }

                        const { authorization: cachedAuthorization, tenantId } = cachedAuth;

                        try {
                            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', cachedAuthorization);
                            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

                            if (serverSettings) {
                                if (serverSettings.password === undefined) {
                                    serverSettings.password = '';
                                }

                                let epicorUpdateSuccessful = true;

                                // Update Epicor FIRST
                                for (const id of erpInvoiceIds) {
                                    try {
                                        await this.epicorService.updateInvoiceStatus(serverSettings, id, {
                                            ELIEInvoice: true,
                                            ELIEInvUpdatedBy: 'system',
                                            ELIEInvException: this.buildELIEInvExceptionJson({
                                                status: 'ERROR',
                                                comment: `Error in merged invoice: ${data.statusMessage}`,
                                                EInvRefNum: orderNo,
                                            }),
                                            ELIEInvUpdatedOn: new Date().toISOString(),
                                            RowMod: 'U'
                                        });
                                        this.logger.log(`Successfully updated invoice ${id} with error status in Epicor via callback`);
                                    } catch (error) {
                                        this.logger.error(`Could not update invoice with ID ${id} in Epicor: ${error.message}`);
                                        epicorUpdateSuccessful = false;
                                    }
                                }

                                // Only update local database AFTER successful Epicor updates
                                if (epicorUpdateSuccessful) {
                                    for (const id of erpInvoiceIds) {
                                        try {
                                            const localInvoice = await this.invoiceRepository.findOne({
                                                where: { erpInvoiceId: id }
                                            });

                                            if (localInvoice) {
                                                await this.invoiceRepository.update(localInvoice.id, {
                                                    status: 'ERROR',
                                                    comment: `Error in merged invoice: ${data.statusMessage}`,
                                                    updatedAt: new Date(),
                                                });
                                                this.logger.log(`Updated local cache error status for invoice ${id} after successful Epicor update`);
                                            }
                                        } catch (cacheError) {
                                            this.logger.warn(`Failed to update local cache error status for invoice ${id}: ${cacheError.message}`);
                                        }
                                    }
                                }
                            }
                        } catch (configOrUpdateError) {
                            this.logger.warn(`Failed to update invoice ${erpInvoiceIds[0]} with error status in Epicor: ${configOrUpdateError.message}`);
                        }
                    }
                }

                return {
                    success: false,
                    message: 'Error processing merged invoice callback',
                    error: data.statusMessage
                };
            }
        } catch (error) {
            this.logger.error(`Error processing merged invoice callback: ${error.message}`, error.stack);
            throw error;
        }
    }
} 