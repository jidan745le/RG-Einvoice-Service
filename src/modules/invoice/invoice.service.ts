import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { BaiwangService } from '../baiwang/baiwang.service';
import { EpicorService } from '../epicor/epicor.service';
import { v4 as uuidv4 } from 'uuid';
import { EpicorInvoice } from '../epicor/interfaces/epicor.interface';
import { TenantConfigService } from '../tenant/tenant-config.service';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceDetail)
    private readonly invoiceDetailRepository: Repository<InvoiceDetail>,
    private readonly baiwangService: BaiwangService,
    private readonly epicorService: EpicorService,
    private readonly tenantConfigService: TenantConfigService,
  ) { }

  /**
   * Create a new invoice
   * @param createInvoiceDto Invoice data
   * @returns Created invoice
   */
  async create(createInvoiceDto: CreateInvoiceDto): Promise<Invoice> {
    const { details, ...invoiceData } = createInvoiceDto;

    // Create invoice with proper type conversion
    const invoice = this.invoiceRepository.create({
      ...invoiceData,
      status: 'PENDING',
      orderNumber: invoiceData.orderNumber?.toString(),
      erpInvoiceId: Number(invoiceData.erpInvoiceId),
      invoiceAmount: invoiceData.invoiceAmount ? Number(invoiceData.invoiceAmount) : undefined,
    });

    const savedInvoice = await this.invoiceRepository.save(invoice);

    // Create invoice details if provided
    if (details && details.length > 0) {
      const invoiceDetails = details.map(detail => this.invoiceDetailRepository.create({
        ...detail,
        invoiceId: savedInvoice.id,
        erpInvoiceId: savedInvoice.erpInvoiceId,
        sellingShipQty: detail.sellingShipQty ? Number(detail.sellingShipQty) : undefined,
        docUnitPrice: detail.docUnitPrice ? Number(detail.docUnitPrice) : undefined,
        docExtPrice: detail.docExtPrice ? Number(detail.docExtPrice) : undefined,
        taxPercent: detail.taxPercent ? Number(detail.taxPercent) : undefined,
      }));

      await this.invoiceDetailRepository.save(invoiceDetails);
    }

    return savedInvoice;
  }

  /**
   * Find all invoices with pagination and filtering
   * @param queryDto Query parameters
   * @returns Paginated list of invoices with details and status totals
   */
  async findAll(queryDto: QueryInvoiceDto): Promise<{
    items: Invoice[];
    total: number;
    page: number;
    limit: number;
    totals: {
      PENDING: number;
      SUBMITTED: number;
      ERROR: number;
      RED_NOTE: number;
      [key: string]: number; // 允许动态键名
    };
  }> {
    const { page = 1, limit = 10, ...filters } = queryDto;

    // 构建主查询获取分页结果
    const queryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.invoiceDetails', 'invoiceDetails');

    // 构建状态统计查询
    const statusQueryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
      .select('invoice.status', 'status')
      .addSelect('COUNT(invoice.id)', 'count');

    // 对两个查询应用相同的过滤条件
    if (filters.erpInvoiceId) {
      const erpFilter = 'CAST(invoice.erpInvoiceId AS CHAR) LIKE :erpInvoiceId';
      queryBuilder.andWhere(erpFilter, { erpInvoiceId: `%${filters.erpInvoiceId}%` });
      statusQueryBuilder.andWhere(erpFilter, { erpInvoiceId: `%${filters.erpInvoiceId}%` });
    }

    if (filters.customerName) {
      const customerFilter = 'invoice.customerName LIKE :customerName';
      queryBuilder.andWhere(customerFilter, { customerName: `%${filters.customerName}%` });
      statusQueryBuilder.andWhere(customerFilter, { customerName: `%${filters.customerName}%` });
    }

    if (filters.status) {
      const statusFilter = 'invoice.status = :status';
      queryBuilder.andWhere(statusFilter, { status: filters.status });
      // statusQueryBuilder.andWhere(statusFilter, { status: filters.status });
    }

    if (filters.eInvoiceId) {
      const eInvoiceFilter = 'invoice.eInvoiceId = :eInvoiceId';
      queryBuilder.andWhere(eInvoiceFilter, { eInvoiceId: filters.eInvoiceId });
      statusQueryBuilder.andWhere(eInvoiceFilter, { eInvoiceId: filters.eInvoiceId });
    }

    if (filters.startDate) {
      const startDateFilter = 'invoice.orderDate >= :startDate';
      queryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
      statusQueryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
    }

    if (filters.endDate) {
      const endDateFilter = 'invoice.orderDate <= :endDate';
      queryBuilder.andWhere(endDateFilter, { endDate: filters.endDate });
      statusQueryBuilder.andWhere(endDateFilter, { endDate: filters.endDate });
    }

    if (filters.fapiaoType) {
      const fapiaoFilter = 'invoice.fapiaoType = :fapiaoType';
      queryBuilder.andWhere(fapiaoFilter, { fapiaoType: filters.fapiaoType });
      statusQueryBuilder.andWhere(fapiaoFilter, { fapiaoType: filters.fapiaoType });
    }

    if (filters.submittedBy) {
      const submitterFilter = 'invoice.submittedBy = :submittedBy';
      queryBuilder.andWhere(submitterFilter, { submittedBy: filters.submittedBy });
      statusQueryBuilder.andWhere(submitterFilter, { submittedBy: filters.submittedBy });
    }

    // 计算总记录数
    const total = await queryBuilder.getCount();

    // 添加分页和排序
    queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('invoice.createdAt', 'DESC');

    // 执行分页查询获取列表项
    const items = await queryBuilder.getMany();

    // 添加分组统计并执行查询
    statusQueryBuilder.groupBy('invoice.status');
    const statusCounts = await statusQueryBuilder.getRawMany();

    // 创建状态计数对象并初始化所有状态为0
    const totals = {
      PENDING: 0,
      SUBMITTED: 0,
      ERROR: 0,
      RED_NOTE: 0,
      TOTAL: 0,
    };

    // 用查询结果填充状态计数
    statusCounts.forEach(item => {
      totals[item.status] = parseInt(item.count, 10);
    });
    totals.TOTAL = totals.PENDING + totals.SUBMITTED + totals.ERROR + totals.RED_NOTE;

    return {
      items,
      total,
      page,
      limit,
      totals
    };
  }

  /**
   * Find invoice by ID
   * @param id Invoice ID
   * @returns Invoice with details
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
   * Find invoice by ERP invoice ID
   * @param erpInvoiceId ERP invoice ID
   * @returns Invoice with details
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
   * Update invoice by ID
   * @param id Invoice ID
   * @param updateInvoiceDto Updated invoice data
   * @returns Updated invoice
   */
  async update(id: number, updateInvoiceDto: UpdateInvoiceDto): Promise<Invoice> {
    const invoice = await this.findOne(id);

    const { details, ...invoiceData } = updateInvoiceDto;

    // Update invoice
    await this.invoiceRepository.update(id, {
      ...invoiceData,
      orderNumber: invoiceData.orderNumber?.toString(), // Convert to string if it exists
    });

    // Update details if provided
    if (details && details.length > 0) {
      // Delete existing details
      await this.invoiceDetailRepository.delete({ invoiceId: id });

      // Create new details
      const invoiceDetails = details.map(detail => this.invoiceDetailRepository.create({
        ...detail,
        invoiceId: id,
        erpInvoiceId: invoice.erpInvoiceId,
      }));

      await this.invoiceDetailRepository.save(invoiceDetails);
    }

    return this.findOne(id);
  }

  /**
   * Submit invoice to Baiwang for e-invoicing
   * @param id Invoice ID
   * @param submittedBy User who submitted the invoice
   * @param tenantId Tenant ID
   * @param authorization Authorization header from request
   * @returns Result of submission
   */
  async submitInvoice(id: number, submittedBy: string, tenantId: string = 'default', authorization?: string): Promise<any> {
    try {
      // 初始化百望服务，获取租户特定配置
      await this.baiwangService.initialize(tenantId, authorization);

      // 获取发票和明细
      const invoice = await this.findOne(id);
      const details = await this.invoiceDetailRepository.find({
        where: {
          invoice: {
            erpInvoiceId: id
          }
        }
      });

      if (!details.length) {
        throw new Error('Cannot submit invoice without details');
      }

      // 获取公司信息配置
      const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

      // Generate order number using UUID (shortened) and include erpInvoiceId for easier retrieval in callback
      const orderNo = `ORD-${uuidv4().substring(0, 8)}-${invoice.erpInvoiceId}`;

      // Map invoice details to Baiwang format
      const invoiceDetailList = details.map(detail => ({
        goodsTaxRate: String((detail.taxPercent ? parseFloat(String(detail.taxPercent)) / 100 : 0.13).toFixed(2)),
        goodsTotalPrice: String(detail.docExtPrice || '0'),
        goodsPrice: String(detail.docUnitPrice || '0'),
        goodsQuantity: String(detail.sellingShipQty || '1'),
        goodsUnit: detail.salesUm || '',
        goodsName: detail.lineDescription || 'Product',
      }));

      // Create Baiwang request
      const baiwangRequest = {
        buyerTelephone: '',
        priceTaxMark: '0',
        callBackUrl: 'http://8.219.189.158:81/e-invoice/api/invoice/callback',
        invoiceDetailList,
        sellerAddress: companyInfo.address || 'Environment issue immediately',
        buyerAddress: 'Test address',
        buyerBankName: 'Test bank name',
        invoiceType: '1',
        taxNo: companyInfo.taxNo || '338888888888SMB',
        orderDateTime: new Date().toISOString().split('T')[0] + ' 10:00:00',
        orderNo,
        buyerName: invoice.customerName || 'Test Company',
        invoiceTypeCode: '02',
        sellerBankName: companyInfo.bankName || 'Test Bank',
        remarks: invoice.invoiceComment || 'Invoice',
      };

      // Submit to Baiwang
      const result = await this.baiwangService.submitInvoice(baiwangRequest);

      // Update invoice status and submitter
      await this.invoiceRepository.update(invoice.id, {
        status: 'PENDING',
        submittedBy,
      });

      return {
        success: true,
        message: 'Invoice submitted successfully',
        data: result,
      };
    } catch (error) {
      this.logger.error(`Error submitting invoice ${id}: ${error.message}`, error.stack);

      // Update invoice status to ERROR
      await this.invoiceRepository.update(id, {
        status: 'ERROR',
        comment: `Error: ${error.message}`,
      });

      throw error;
    }
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
            // Try to extract the erpInvoiceId from the orderNo if it was formatted that way during submission
            const match = orderNo.match(/ORD-[a-f0-9]+-(\d+)/);
            if (match && match[1]) {
              erpInvoiceId = parseInt(match[1], 10);
            }
          } catch (error) {
            this.logger.warn(`Could not extract erpInvoiceId from : ${orderNo}`);
          }
        }

        // If we couldn't extract from orderNo, try to find by other means
        let invoice;
        if (erpInvoiceId) {
          invoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId }
          });
        }

        if (!invoice) {
          throw new Error(`Could not find invoice with orderNo: ${orderNo}`);
        }

        // Update invoice with e-invoice information
        await this.invoiceRepository.update(invoice.id, {
          status: 'SUBMITTED',
          eInvoiceId: data.serialNo, // serialNo as E-Invoice ID
          eInvoiceDate: new Date(data.invoiceTime), // Invoice time as E-Invoice Date
          submittedBy: data.drawer || invoice.submittedBy, // Drawer as submitter
          eInvoicePdf: data.pdfUrl, // PDF URL
          orderNumber: orderNo, // Store the orderNo
          digitInvoiceNo: data.digitInvoiceNo,
          comment: `E-Invoice issued successfully: ${data.statusMessage}`
        });

        return {
          success: true,
          message: 'Invoice updated successfully',
          data: {
            erpInvoiceId,
            status: 'SUBMITTED',
            eInvoiceId: data.serialNo,
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
            const match = data.orderNo.match(/ORD-[a-f0-9]+-(\d+)/);
            if (match && match[1]) {
              erpInvoiceId = parseInt(match[1], 10);
            }
          } catch (error) {
            this.logger.warn(`Could not extract erpInvoiceId from orderNo: ${data.orderNo}`);
          }
        }

        if (erpInvoiceId) {
          const invoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId }
          });

          if (invoice) {
            await this.invoiceRepository.update(invoice.id, {
              status: 'ERROR',
              orderNumber: data.orderNo, // Store the orderNo even for failed attempts
              comment: `E-Invoice error: ${data.statusMessage || data.errorMessage || 'Unknown error'}`
            });
          }
        }

        return {
          success: false,
          message: 'Invoice status update failed',
          error: data.statusMessage || data.errorMessage || 'Unknown error'
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
   * Sync invoices from Epicor
   * @returns Sync result
   */
  async syncFromEpicor(): Promise<any> {
    try {
      this.logger.log('Syncing invoices from Epicor');

      // Get last sync date
      const lastInvoice = await this.invoiceRepository.findOne({
        where: {},
        order: { createdAt: 'DESC' },
      });

      const lastSyncDate = lastInvoice?.createdAt || undefined;

      // Sync invoices from Epicor
      const epicorResponse = await this.epicorService.syncInvoices(lastSyncDate);

      // Group invoices by InvcDtl_InvoiceNum
      const groupedInvoices = this.groupInvoicesByNumber(epicorResponse.value);

      // Process each invoice group
      const processedInvoices: { erpInvoiceId: number; status: string; error?: string }[] = [];

      for (const [invoiceNum, invoiceDetails] of Object.entries(groupedInvoices)) {
        try {
          // Use the first item for header information
          const firstInvoice = invoiceDetails[0];

          // Check if invoice already exists
          const existingInvoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId: firstInvoice.InvcHead_InvoiceNum },
          });

          if (existingInvoice) {
            this.logger.log(`Invoice ${firstInvoice.InvcHead_InvoiceNum} already exists. Skipping.`);
            continue;
          }

          // Create new invoice
          const newInvoice = this.invoiceRepository.create({
            erpInvoiceId: firstInvoice.InvcHead_InvoiceNum,
            erpInvoiceDescription: firstInvoice.InvcHead_Description,
            customerName: firstInvoice.Customer_Name,
            customerResaleId: firstInvoice.Customer_ResaleID,
            invoiceComment: firstInvoice.InvcHead_InvoiceComment,
            orderNumber: firstInvoice.OrderHed_OrderNum?.toString(),
            orderDate: new Date(firstInvoice.OrderHed_OrderDate),
            poNumber: firstInvoice.OrderHed_PONum,
            status: 'PENDING',
          });

          const savedInvoice = await this.invoiceRepository.save(newInvoice);
          let pendingInsertedInvoiceDetails: InvoiceDetail[] = [];
          // Create invoice details for each detail line
          for (const detail of invoiceDetails) {
            pendingInsertedInvoiceDetails.push(this.invoiceDetailRepository.create({
              invoiceId: savedInvoice.id,
              erpInvoiceId: detail.InvcDtl_InvoiceNum,
              lineDescription: detail.InvcDtl_LineDesc,
              commodityCode: detail.InvcDtl_CommodityCode,
              uomDescription: detail.UOMClass_Description,
              salesUm: detail.InvcDtl_SalesUM,
              sellingShipQty: parseFloat(detail.InvcDtl_SellingShipQty),
              docUnitPrice: parseFloat(detail.InvcDtl_DocUnitPrice),
              docExtPrice: parseFloat(detail.InvcDtl_DocExtPrice),
              taxPercent: parseFloat(detail.InvcTax_Percent),
            }));
          }
          await this.invoiceDetailRepository.save(pendingInsertedInvoiceDetails);

          processedInvoices.push({
            erpInvoiceId: savedInvoice.erpInvoiceId,
            status: 'CREATED',
          });
        } catch (error) {
          this.logger.error(`Error processing invoice ${invoiceNum}: ${error.message}`, error.stack);
          processedInvoices.push({
            erpInvoiceId: parseInt(invoiceNum),
            status: 'ERROR',
            error: error.message,
          });
        }
      }

      return {
        success: true,
        message: `Synced ${processedInvoices.length} invoices from Epicor`,
        data: processedInvoices,
      };
    } catch (error) {
      this.logger.error(`Error syncing from Epicor: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Group invoice details by invoice number
   * @param invoices Array of EpicorInvoice objects
   * @returns Object with invoice numbers as keys and arrays of invoice details as values
   */
  private groupInvoicesByNumber(invoices: EpicorInvoice[]): Record<string, EpicorInvoice[]> {
    const grouped: Record<string, EpicorInvoice[]> = {};

    for (const invoice of invoices) {
      const invoiceNum = invoice.InvcHead_InvoiceNum.toString();

      if (!grouped[invoiceNum]) {
        grouped[invoiceNum] = [];
      }

      grouped[invoiceNum].push(invoice);
    }

    return grouped;
  }

  /**
   * Submit red invoice request to Baiwang
   * @param id Original invoice ID
   * @param submittedBy User who submitted the red invoice
   * @param tenantId Tenant ID
   * @param authorization Authorization header from request
   * @returns Result of red invoice submission
   */
  async submitRedInvoice(id: number, submittedBy: string, tenantId: string = 'default', authorization?: string): Promise<any> {
    try {
      // 初始化百望服务，获取租户特定配置
      await this.baiwangService.initialize(tenantId, authorization);

      // 获取公司信息配置
      const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

      // Get original invoice
      const originalInvoice = await this.findOne(id);
      if (!originalInvoice) {
        throw new NotFoundException(`Invoice with ID ${id} not found`);
      }

      // Generate order number for red invoice
      const orderNo = `RED-${uuidv4().substring(0, 8)}-${originalInvoice.erpInvoiceId}`;

      // Prepare red invoice request
      const request = {
        taxNo: companyInfo.taxNo || '338888888888SMB',
        orderNo,
        originalSerialNo: originalInvoice.eInvoiceId,
        originalOrderNo: originalInvoice.orderNumber,
        originalDigitInvoiceNo: originalInvoice.digitInvoiceNo,
        callBackUrl: 'http://8.219.189.158:81/e-invoice/api/invoice/red/callback',
      };

      // Submit to Baiwang
      const result = await this.baiwangService.submitRedInvoice(request);

      // Create a new invoice record for the red invoice
      const redInvoice = this.invoiceRepository.create({
        erpInvoiceId: originalInvoice.erpInvoiceId,
        status: 'PENDING',
        orderNumber: orderNo,
        customerName: originalInvoice.customerName,
        customerResaleId: originalInvoice.customerResaleId,
        invoiceComment: `Red invoice for ${originalInvoice.erpInvoiceId}`,
        fapiaoType: 'RED',
        submittedBy,
      });

      // const savedRedInvoice = await this.invoiceRepository.save(redInvoice);

      // // Copy invoice details
      // const redInvoiceDetails = originalInvoice.invoiceDetails.map(detail =>
      //   this.invoiceDetailRepository.create({
      //     invoiceId: savedRedInvoice.id,
      //     erpInvoiceId: detail.erpInvoiceId,
      //     lineDescription: detail.lineDescription,
      //     commodityCode: detail.commodityCode,
      //     uomDescription: detail.uomDescription,
      //     salesUm: detail.salesUm,
      //     sellingShipQty: detail.sellingShipQty,
      //     docUnitPrice: detail.docUnitPrice,
      //     docExtPrice: detail.docExtPrice,
      //     taxPercent: detail.taxPercent,
      //   })
      // );

      // await this.invoiceDetailRepository.save(redInvoiceDetails);

      return {
        success: true,
        message: 'Red invoice submitted successfully',
        data: {
          orderNo,
          redInvoiceId: redInvoice?.id,
          result
        }
      };
    } catch (error) {
      this.logger.error(`Error submitting red invoice: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Process red info callback from Baiwang
   * @param callbackData Callback data from Baiwang
   * @returns Process result
   */
  async processRedInfoCallback(callbackData: any): Promise<any> {
    this.logger.log(`Processing red info callback: ${JSON.stringify(callbackData)}`);

    try {
      // Parse callback data
      const callbackJson = typeof callbackData === 'string' ? JSON.parse(callbackData) : callbackData;
      const data = typeof callbackJson.data === 'string' ? JSON.parse(callbackJson.data) : callbackJson.data;

      // Only process red confirm callbacks
      if (callbackJson.method !== 'baiwang.s.callback.redconfirm') {
        return {
          success: true,
          message: 'Ignoring non-red-confirm callback',
          data: {
            method: callbackJson.method
          }
        };
      }

      // Find the invoice using orderNo which contains the ERP invoice ID
      const orderNo = data.orderNo;
      let erpInvoiceId: number | undefined = undefined;

      if (orderNo) {
        try {
          // Try to extract the erpInvoiceId from the orderNo if it was formatted that way during submission
          const match = orderNo.match(/RED-[a-f0-9]+-(\d+)/);
          if (match && match[1]) {
            erpInvoiceId = parseInt(match[1], 10);
          }
        } catch (error) {
          this.logger.warn(`Could not extract erpInvoiceId from orderNo: ${orderNo}`);
        }
      }

      // If we couldn't extract from orderNo, try to find by other means
      let invoice;
      if (erpInvoiceId) {
        invoice = await this.invoiceRepository.findOne({
          where: { erpInvoiceId }
        });
      }

      if (!invoice) {
        throw new Error(`Could not find invoice with orderNo: ${orderNo}`);
      }

      // Update invoice with red info information
      await this.invoiceRepository.update(invoice.id, {
        status: data.redConfirmStatus === '01' ? 'RED_NOTE' : 'ERROR',
        redInfoNo: data.redConfirmNo,
        redInfoSerialNo: data.redConfirmSerialNo,
        redInfoStatus: data.redConfirmStatus,
        redInfoMessage: data.redConfirmMessage,
        redInfoType: data.redConfirmType,
        comment: `Red info ${data.redConfirmStatus === '01' ? 'approved' : 'rejected'}: ${data.redConfirmMessage}`
      });

      return {
        success: true,
        message: 'Red info callback processed successfully',
        data: {
          erpInvoiceId,
          status: data.redConfirmStatus === '01' ? 'RED_NOTE' : 'ERROR',
          redInfoNo: data.redConfirmNo,
          redInfoSerialNo: data.redConfirmSerialNo
        }
      };
    } catch (error) {
      this.logger.error(`Error processing red info callback: ${error.message}`, error.stack);
      return {
        success: false,
        message: 'Error processing red info callback',
        error: error.message
      };
    }
  }

  /**
   * 合并发票并提交到百望
   * @param mergeDto 包含要合并的发票ID和提交人
   * @param tenantId 租户ID
   * @param authorization Authorization header from request
   * @returns 合并结果
   */
  async mergeAndSubmitInvoices(mergeDto: { erpInvoiceIds: number[]; submittedBy: string }, tenantId: string = 'default', authorization?: string): Promise<any> {
    try {
      // 初始化百望服务，获取租户特定配置
      await this.baiwangService.initialize(tenantId, authorization);

      // 获取公司信息配置
      const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

      const { erpInvoiceIds, submittedBy } = mergeDto;
      this.logger.log(`Merging invoices: ${erpInvoiceIds.join(', ')} by ${submittedBy}`);

      if (!erpInvoiceIds.length) {
        throw new Error('At least one invoice ID must be provided');
      }

      // 获取所有要合并的发票
      const invoices: Invoice[] = [];
      for (const id of erpInvoiceIds) {
        try {
          const invoice = await this.findByErpInvoiceId(id);
          invoices.push(invoice);
        } catch (error) {
          this.logger.error(`Could not find invoice with ID ${id}: ${error.message}`);
          throw new Error(`Invoice with ID ${id} not found`);
        }
      }

      // 验证所有发票是否属于同一客户
      const firstCustomer = invoices[0].customerName;
      const firstCustomerResaleId = invoices[0].customerResaleId;
      for (const invoice of invoices) {
        if (invoice.customerName !== firstCustomer) {
          throw new Error(`All invoices must be from the same customer. Expected ${firstCustomer}, got ${invoice.customerName}`);
        }
        if (invoice.customerResaleId !== firstCustomerResaleId) {
          throw new Error(`All invoices must have the same customer resale ID. Expected ${firstCustomerResaleId}, got ${invoice.customerResaleId}`);
        }
        if (invoice.status === 'SUBMITTED') {
          throw new Error(`Invoice with ID ${invoice.erpInvoiceId} has already been submitted`);
        }
      }

      // 收集所有发票明细
      let allDetails: InvoiceDetail[] = [];
      for (const invoice of invoices) {
        const details = await this.invoiceDetailRepository.find({
          where: { invoiceId: invoice.id }
        });
        allDetails = [...allDetails, ...details];
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

      // 创建百望请求
      const baiwangRequest = {
        buyerTelephone: '',
        priceTaxMark: '0',
        callBackUrl: 'http://8.219.189.158:81/e-invoice/api/invoice/callback',
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
      const result = await this.baiwangService.submitInvoice(baiwangRequest);

      // 更新所有发票状态
      for (const invoice of invoices) {
        await this.invoiceRepository.update(invoice.id, {
          status: 'PENDING',
          submittedBy,
          orderNumber: orderNo,
          comment: `Merged with invoices: ${erpInvoiceIds.filter(id => id !== invoice.erpInvoiceId).join(', ')}`,
        });
      }

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

        // 从orderNo中提取所有的erpInvoiceId
        if (!orderNo || !orderNo.startsWith('MERGE-')) {
          // 如果不是合并发票的回调，交由普通回调处理
          return this.processCallback(callbackData);
        }

        let erpInvoiceIds: number[] = [];
        try {
          // 从orderNo中提取所有的erpInvoiceId
          const match = orderNo.match(/MERGE-[a-f0-9]+-(.+)/);
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

        // 查找所有相关发票
        const invoices: Invoice[] = [];
        for (const id of erpInvoiceIds) {
          try {
            const invoice = await this.findByErpInvoiceId(id);
            invoices.push(invoice);
          } catch (error) {
            this.logger.error(`Could not find invoice with ID ${id}: ${error.message}`);
          }
        }

        if (!invoices.length) {
          throw new Error(`Could not find any invoices with order number: ${orderNo}`);
        }

        // 更新所有发票的电子发票信息
        for (const invoice of invoices) {
          await this.invoiceRepository.update(invoice.id, {
            status: 'SUBMITTED',
            eInvoiceId: data.serialNo, // 使用serialNo作为电子发票ID
            eInvoiceDate: new Date(data.invoiceTime), // 使用invoiceTime作为电子发票日期
            submittedBy: data.drawer || invoice.submittedBy, // 使用drawer作为提交者
            eInvoicePdf: data.pdfUrl, // PDF URL
            orderNumber: orderNo, // 存储orderNo
            digitInvoiceNo: data.digitInvoiceNo,
            comment: `E-Invoice issued successfully for merged invoices: ${erpInvoiceIds.join(', ')}`
          });
        }

        return {
          success: true,
          message: 'Merged invoices updated successfully',
          data: {
            erpInvoiceIds,
            status: 'SUBMITTED',
            eInvoiceId: data.serialNo,
            orderNo
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
            const match = orderNo.match(/MERGE-[a-f0-9]+-(.+)/);
            if (match && match[1]) {
              erpInvoiceIds = match[1].split('-').map(id => parseInt(id, 10));
            }
          } catch (error) {
            this.logger.warn(`Could not extract erpInvoiceIds from : ${orderNo}`);
          }

          // 更新所有相关发票的状态
          if (erpInvoiceIds.length) {
            for (const id of erpInvoiceIds) {
              try {
                const invoice = await this.findByErpInvoiceId(id);
                await this.invoiceRepository.update(invoice.id, {
                  status: 'ERROR',
                  comment: `Error in merged invoice: ${data.statusMessage}`,
                });
              } catch (error) {
                this.logger.error(`Could not update invoice with ID ${id}: ${error.message}`);
              }
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

  /**
   * 合并类似的发票明细行
   * @param details 发票明细列表
   * @returns 合并后的百望发票明细列表
   */
  private mergeInvoiceDetails(details: InvoiceDetail[]): any[] {
    // 用于存储合并后的商品行，键为商品代码+单价+税率
    const mergedMap: Record<string, any> = {};

    for (const detail of details) {
      // 创建唯一键
      const key = `${detail.commodityCode || ''}-${detail.docUnitPrice || 0}-${detail.taxPercent || 0}`;

      if (!mergedMap[key]) {
        // 如果这个商品行还没有合并过，创建一个新的
        mergedMap[key] = {
          goodsTaxRate: String((detail.taxPercent ? parseFloat(String(detail.taxPercent)) / 100 : 0.13).toFixed(2)),
          goodsTotalPrice: String(detail.docExtPrice || '0'),
          goodsPrice: String(detail.docUnitPrice || '0'),
          goodsQuantity: String(detail.sellingShipQty || '1'),
          goodsUnit: detail.salesUm || '',
          goodsName: detail.lineDescription || 'Product',
          _originalQuantity: parseFloat(String(detail.sellingShipQty)) || 1,
          _originalTotal: parseFloat(String(detail.docExtPrice)) || 0,
        };
      } else {
        // 如果已经有了，增加数量和总价
        const currentItem = mergedMap[key];
        const additionalQty = parseFloat(String(detail.sellingShipQty)) || 1;
        const additionalTotal = parseFloat(String(detail.docExtPrice)) || 0;

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
}
