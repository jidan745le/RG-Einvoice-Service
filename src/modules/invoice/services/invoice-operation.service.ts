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
import { EpicorInvoiceHeader } from '../../epicor/interfaces/epicor.interface';

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

            // 5. Update invoice status in Epicor directly
            await this.epicorService.updateInvoiceStatus(serverSettings, id, {
                ELIEInvoice: true,
                ELIEInvStatus: 0, // 0 = PENDING
                ELIEInvUpdatedBy: submittedBy,
                ELIEInvException: '',
                ELIEInvUpdatedOn: new Date().toISOString(),
                EInvRefNum: orderNo,
                RowMod: 'U'
            });

            // 6. Update local cache status (if the invoice exists in cache)
            try {
                const localInvoice = await this.invoiceRepository.findOne({
                    where: { erpInvoiceId: id }
                });

                if (localInvoice) {
                    await this.invoiceRepository.update(localInvoice.id, {
                        status: 'PENDING',
                        submittedBy,
                        updatedAt: new Date(),
                    });
                    this.logger.log(`Updated local cache status for invoice ${id}`);
                }
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
                        ELIEInvStatus: 2, // 2 = ERROR
                        ELIEInvUpdatedBy: submittedBy,
                        ELIEInvException: `Error: ${error.message}`,
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
            const updatePromises = validInvoices.map(invoice =>
                this.epicorService.updateInvoiceStatus(serverSettings, invoice.InvoiceNum, {
                    ELIEInvoice: true,
                    ELIEInvStatus: 0, // 0 = PENDING
                    ELIEInvUpdatedBy: submittedBy,
                    ELIEInvException: `Merged with invoices: ${erpInvoiceIds.filter(id => id !== invoice.InvoiceNum).join(', ')}`,
                    ELIEInvUpdatedOn: new Date().toISOString(),
                    EInvRefNum: orderNo,
                    RowMod: 'U'
                }).catch(error => {
                    this.logger.error(`Could not update invoice ${invoice.InvoiceNum} status in Epicor: ${error.message}`);
                    return null;
                })
            );

            // 并行更新本地缓存状态
            const localUpdatePromises = erpInvoiceIds.map(async (id) => {
                try {
                    const localInvoice = await this.invoiceRepository.findOne({
                        where: { erpInvoiceId: id }
                    });

                    if (localInvoice) {
                        await this.invoiceRepository.update(localInvoice.id, {
                            status: 'PENDING',
                            submittedBy,
                            orderNumber: orderNo,
                            comment: `Merged with invoices: ${erpInvoiceIds.filter(otherId => otherId !== id).join(', ')}`,
                            updatedAt: new Date(),
                        });
                    }
                } catch (error) {
                    this.logger.warn(`Failed to update local cache for invoice ${id}: ${error.message}`);
                }
            });

            // 等待所有更新完成
            await Promise.all([...updatePromises, ...localUpdatePromises]);

            this.logger.log(`Successfully merged and submitted ${erpInvoiceIds.length} invoices with orderNo: ${orderNo}`);

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
} 