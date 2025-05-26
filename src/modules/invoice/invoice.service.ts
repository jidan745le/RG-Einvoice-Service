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
import { EpicorInvoice, EpicorInvoiceHeader } from '../epicor/interfaces/epicor.interface';
import { TenantConfigService } from '../tenant/tenant-config.service';
import { EpicorTenantConfig } from '../epicor/epicor.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

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
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
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
   * @param tenantId Tenant ID
   * @param authorization Authorization header
   * @returns Paginated list of invoices with details and status totals
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
      [key: string]: number; // 允许动态键名
    };
  }> {
    const { page = 1, limit = 10, ...filters } = queryDto;


    if (!tenantId || !authorization) {
      this.logger.error('Tenant ID and Authorization are required when fromEpicor is true.');
      throw new Error('Tenant ID and Authorization are required for fetching from Epicor.');
    }
    try {
      const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
      const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

      if (!serverSettings || !serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
        this.logger.error('Epicor server settings are missing or incomplete from tenant configuration.');
        throw new Error('Epicor server configuration is incomplete.');
      }

      if (serverSettings.password === undefined) {
        serverSettings.password = '';
      }

      const filterClauses: string[] = [];
      if (filters.erpInvoiceId) {
        try {
          // Parse the input as a number for exact matching
          const numValue = Number(filters.erpInvoiceId);
          if (!isNaN(numValue)) {
            // Use string concatenation with explicit string conversion
            filterClauses.push('InvcHead_InvoiceNum eq ' + numValue.toString());
          }
        } catch (e) {
          // If parsing fails, skip this filter
          this.logger.warn(`Could not parse erpInvoiceId filter "${filters.erpInvoiceId}" as a number`);
        }
      }
      if (filters.customerName) {
        filterClauses.push(`substringof(Customer_Name, '${filters.customerName}')`);
      }
      if (filters.eInvoiceId) {
        filterClauses.push(`InvcHead_ELIEInvID eq '${filters.eInvoiceId}'`);
      }

      const formatDate = (dateInput: string | Date): string | null => {
        if (!dateInput) return null;
        try {
          const d = new Date(dateInput);
          if (isNaN(d.getTime())) return null;
          return d.toISOString().split('T')[0]; // 'YYYY-MM-DD'
        } catch { return null; }
      };

      if (filters.startDate) {
        const formattedDate = formatDate(filters.startDate);
        if (formattedDate) {
          filterClauses.push(`OrderHed_OrderDate ge datetime'${formattedDate}'`);
        }
      }
      if (filters.endDate) {
        const formattedDate = formatDate(filters.endDate);
        if (formattedDate) {
          filterClauses.push(`OrderHed_OrderDate le datetime'${formattedDate}'`);
        }
      }
      if (filters.fapiaoType) {
        // Assuming filters.fapiaoType is a number or a string that can be used directly.
        // If InvcHead_CNTaxInvoiceType is numeric, and filters.fapiaoType is string, it might need conversion or 'eq' might handle it.
        filterClauses.push(`InvcHead_CNTaxInvoiceType eq ${filters.fapiaoType}`);
      }
      if (filters.submittedBy) {
        filterClauses.push(`InvcHead_ELIEInvUpdatedBy eq '${filters.submittedBy}'`);
      }
      // Note: filters.status is intentionally ignored for Epicor queries as per current plan.

      if (filters.invoiceComment) {
        filterClauses.push(`substringof(InvcHead_InvoiceComment, '${filters.invoiceComment}')`);
      }
      const odataFilterString = filterClauses.join(' and ');
      this.logger.log(`Constructed OData Filter for Epicor: ${odataFilterString}`);

      const epicorData = await this.epicorService.fetchAllInvoicesFromBaq(
        serverSettings,
        {
          filter: odataFilterString,
        }
      );

      const epicorInvoicesRaw = epicorData.value || [];
      // this.logger.log(`Epicor invoices: ${JSON.stringify(epicorInvoicesRaw)}`);

      // Transform the new API response structure
      const transformedInvoices: Invoice[] = [];
      for (const epicorInvoice of epicorInvoicesRaw as unknown as EpicorInvoiceHeader[]) {
        const invoice = new Invoice();
        invoice.erpInvoiceId = epicorInvoice.InvoiceNum;
        invoice.erpInvoiceDescription = epicorInvoice.Description || '';
        invoice.fapiaoType = epicorInvoice.CNTaxInvoiceType?.toString() || '';
        invoice.customerName = epicorInvoice.CustomerName || '';
        invoice.customerResaleId = epicorInvoice.CustNum?.toString() || '';
        invoice.invoiceComment = epicorInvoice.InvoiceComment || '';
        invoice.orderNumber = epicorInvoice.OrderNum?.toString() || '';
        invoice.orderDate = epicorInvoice.InvoiceDate ? new Date(epicorInvoice.InvoiceDate) : null;
        invoice.poNumber = epicorInvoice.PONum || '';
        invoice.status = epicorInvoice.ELIEInvStatus === 0 ? 'PENDING' : epicorInvoice.ELIEInvStatus === 1 ? 'SUBMITTED' : 'ERROR';
        invoice.id = epicorInvoice.InvoiceNum;
        invoice.createdAt = epicorInvoice.InvoiceDate ? new Date(epicorInvoice.InvoiceDate) : new Date();
        invoice.updatedAt = epicorInvoice.ELIEInvUpdatedOn ? new Date(epicorInvoice.ELIEInvUpdatedOn) : new Date();

        // Map invoice details from InvcDtls array
        invoice.invoiceDetails = (epicorInvoice.InvcDtls || []).map(detailRaw => {
          const detail = new InvoiceDetail();
          detail.erpInvoiceId = detailRaw.InvoiceNum;
          detail.lineDescription = detailRaw.LineDesc || '';
          detail.commodityCode = detailRaw.CommodityCode || '';
          detail.salesUm = detailRaw.SalesUM || '';
          detail.sellingShipQty = parseFloat(detailRaw.SellingShipQty || "0") || 0;
          detail.uomDescription = `${detailRaw.sellingShipQty}${detailRaw.salesUm}`;
          detail.docUnitPrice = parseFloat(detailRaw.DocUnitPrice || "0") || 0;
          detail.docExtPrice = parseFloat(detailRaw.DocExtPrice || "0") || 0;
          detail.taxPercent = parseFloat(detailRaw.TaxPercent || "0") || 0;
          detail.id = parseInt(`${epicorInvoice.InvoiceNum}${detailRaw.InvoiceLine || Math.random().toString(36).substring(2, 8)}`, 36);
          detail.invoiceId = invoice.id;
          return detail;
        });
        transformedInvoices.push(invoice);
      }

      // Sorting is now on the current page's data. For global sorting, OData $orderby should be used.
      transformedInvoices.sort((a, b) => (b.orderDate?.getTime() || 0) - (a.orderDate?.getTime() || 0)); // Example sort by date
      // this.logger.log(`Transformed invoices: ${JSON.stringify(transformedInvoices)}`);
      const totalItems = epicorData['@odata.count'] !== undefined ? epicorData['@odata.count'] : transformedInvoices.length;
      // If @odata.count is undefined and transformedInvoices.length is used, it's only the current page count if top/skip was effective.

      return {
        items: transformedInvoices.slice((page - 1) * limit, page * limit), // This is now the paginated set from server
        total: totalItems,
        page,
        limit,
        totals: {
          PENDING: transformedInvoices.filter(invoice => invoice.status === 'PENDING').length,
          SUBMITTED: transformedInvoices.filter(invoice => invoice.status === 'SUBMITTED').length,
          ERROR: transformedInvoices.filter(invoice => invoice.status === 'ERROR').length,
          RED_NOTE: transformedInvoices.filter(invoice => invoice.status === 'RED_NOTE').length,
          TOTAL: totalItems,
        },
      };

    } catch (error) {
      this.logger.error(`Error fetching or processing invoices from Epicor: ${error.message}`, error.stack);
      // Return empty or error structure
      return {
        items: [],
        total: 0,
        page,
        limit,
        totals: { PENDING: 0, SUBMITTED: 0, ERROR: 0, RED_NOTE: 0, TOTAL: 0 },
      };
    }


    // Original logic for fetching from local DB
    // const queryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
    //   .leftJoinAndSelect('invoice.invoiceDetails', 'invoiceDetails');

    // // 构建状态统计查询
    // const statusQueryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
    //   .select('invoice.status', 'status')
    //   .addSelect('COUNT(invoice.id)', 'count');

    // // 对两个查询应用相同的过滤条件
    // if (filters.erpInvoiceId) {
    //   const erpFilter = 'CAST(invoice.erpInvoiceId AS CHAR) LIKE :erpInvoiceId';
    //   queryBuilder.andWhere(erpFilter, { erpInvoiceId: `%${filters.erpInvoiceId}%` });
    //   statusQueryBuilder.andWhere(erpFilter, { erpInvoiceId: `%${filters.erpInvoiceId}%` });
    // }

    // if (filters.customerName) {
    //   const customerFilter = 'invoice.customerName LIKE :customerName';
    //   queryBuilder.andWhere(customerFilter, { customerName: `%${filters.customerName}%` });
    //   statusQueryBuilder.andWhere(customerFilter, { customerName: `%${filters.customerName}%` });
    // }

    // if (filters.status) {
    //   const statusFilter = 'invoice.status = :status';
    //   queryBuilder.andWhere(statusFilter, { status: filters.status });
    //   // statusQueryBuilder.andWhere(statusFilter, { status: filters.status });
    // }

    // if (filters.eInvoiceId) {
    //   const eInvoiceFilter = 'invoice.eInvoiceId = :eInvoiceId';
    //   queryBuilder.andWhere(eInvoiceFilter, { eInvoiceId: filters.eInvoiceId });
    //   statusQueryBuilder.andWhere(eInvoiceFilter, { eInvoiceId: filters.eInvoiceId });
    // }

    // if (filters.startDate) {
    //   const startDateFilter = 'invoice.orderDate >= :startDate';
    //   queryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
    //   statusQueryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
    // }

    // if (filters.endDate) {
    //   const endDateFilter = 'invoice.orderDate <= :endDate';
    //   queryBuilder.andWhere(endDateFilter, { endDate: filters.endDate });
    //   statusQueryBuilder.andWhere(endDateFilter, { endDate: filters.endDate });
    // }

    // if (filters.fapiaoType) {
    //   const fapiaoFilter = 'invoice.fapiaoType = :fapiaoType';
    //   queryBuilder.andWhere(fapiaoFilter, { fapiaoType: filters.fapiaoType });
    //   statusQueryBuilder.andWhere(fapiaoFilter, { fapiaoType: filters.fapiaoType });
    // }

    // if (filters.submittedBy) {
    //   const submitterFilter = 'invoice.submittedBy = :submittedBy';
    //   queryBuilder.andWhere(submitterFilter, { submittedBy: filters.submittedBy });
    //   statusQueryBuilder.andWhere(submitterFilter, { submittedBy: filters.submittedBy });
    // }

    // // 计算总记录数
    // const total = await queryBuilder.getCount();

    // // 添加分页和排序
    // queryBuilder
    //   .skip((page - 1) * limit)
    //   .take(limit)
    //   .orderBy('invoice.orderDate', 'DESC');

    // // 执行分页查询获取列表项
    // const items = await queryBuilder.getMany();

    // // 添加分组统计并执行查询
    // statusQueryBuilder.groupBy('invoice.status');
    // const statusCounts = await statusQueryBuilder.getRawMany();

    // // 创建状态计数对象并初始化所有状态为0
    // const totals = {
    //   PENDING: 0,
    //   SUBMITTED: 0,
    //   ERROR: 0,
    //   RED_NOTE: 0,
    //   TOTAL: 0,
    // };

    // // 用查询结果填充状态计数
    // statusCounts.forEach(item => {
    //   totals[item.status] = parseInt(item.count, 10);
    // });
    // totals.TOTAL = totals.PENDING + totals.SUBMITTED + totals.ERROR + totals.RED_NOTE;

    // return {
    //   items,
    //   total,
    //   page,
    //   limit,
    //   totals
    // };
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
   * @param id Invoice ID (ERP Invoice ID)
   * @param submittedBy User who submitted the invoice
   * @param tenantId Tenant ID
   * @param authorization Authorization header from request
   * @returns Result of submission
   */
  async submitInvoice(id: number, submittedBy: string, tenantId: string = 'default', authorization?: string): Promise<any> {
    try {
      // 初始化百望服务，获取租户特定配置
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

      // 直接从Epicor API获取发票数据
      const epicorInvoiceData = await this.epicorService.getInvoiceById(serverSettings, id);

      if (!epicorInvoiceData) {
        throw new Error(`Invoice with ID ${id} not found in Epicor`);
      }

      // 获取公司信息配置
      const companyInfo = await this.tenantConfigService.getCompanyInfo(tenantId, authorization);

      // Generate order number using UUID (shortened) and include erpInvoiceId for easier retrieval in callback
      const orderNo = `ORD-${uuidv4().substring(0, 8)}-${id}`;

      // Map invoice details to Baiwang format from Epicor data
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

      // Submit to Baiwang
      const result = await this.baiwangService.submitInvoice(baiwangRequest);

      // Update invoice status in Epicor directly
      await this.epicorService.updateInvoiceStatus(serverSettings, id, {
        ELIEInvoice: true,
        ELIEInvStatus: 0, // 0 = PENDING
        ELIEInvUpdatedBy: submittedBy,
        ELIEInvException: '',
        ELIEInvUpdatedOn: new Date().toISOString(),
        EInvRefNum: orderNo,
        RowMod: 'U'
      });

      return {
        success: true,
        message: 'Invoice submitted successfully',
        data: result,
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
      this.logger.log(`Parsed callback JSON: ${JSON.stringify(callbackJson)}`);

      const data = typeof callbackJson.data === 'string' ? JSON.parse(callbackJson.data) : callbackJson.data;
      this.logger.log(`Extracted callback data: ${JSON.stringify(data)}`);

      // 检查是否是合并发票的回调
      const orderNo = data.orderNo;
      if (orderNo && orderNo.startsWith('MERGE-')) {
        this.logger.log(`Detected merged invoice callback for orderNo: ${orderNo}`);
        return this.processMergedInvoiceCallback(callbackData);
      }

      // Check if it's a successful invoice
      if (data.status === '01') { // 01 represents success
        this.logger.log(`Processing successful invoice callback with status: ${data.status}`);

        // Find the invoice using orderNo which contains the ERP invoice ID
        const orderNo = data.orderNo;
        this.logger.log(`Callback orderNo: ${orderNo}`);

        // Extract the erpInvoiceId if it's included in the orderNo
        let erpInvoiceId: number | undefined = undefined;
        if (orderNo) {
          try {
            // Try to extract the erpInvoiceId from the orderNo if it was formatted that way during submission
            const match = orderNo.match(/ORD-[a-f0-9]+-(\d+)/);
            if (match && match[1]) {
              erpInvoiceId = parseInt(match[1], 10);
              this.logger.log(`Successfully extracted erpInvoiceId: ${erpInvoiceId} from orderNo: ${orderNo}`);
            } else {
              this.logger.warn(`No match found for erpInvoiceId pattern in orderNo: ${orderNo}`);
            }
          } catch (error) {
            this.logger.error(`Error extracting erpInvoiceId from orderNo: ${orderNo}`, error.stack);
          }
        } else {
          this.logger.error('OrderNo is missing from callback data');
        }

        if (!erpInvoiceId) {
          const errorMsg = `Could not extract erpInvoiceId from orderNo: ${orderNo}`;
          this.logger.error(errorMsg);
          throw new Error(errorMsg);
        }

        // Get Epicor configuration from default tenant (we'll need to enhance this to get the correct tenant)
        // For now, we'll use a default configuration approach
        const tenantId = 'default'; // This should be enhanced to get the correct tenant
        this.logger.log(`Getting Epicor configuration for tenant: ${tenantId}`);

        try {
          const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice');
          this.logger.log(`Retrieved app config: ${appConfig ? 'success' : 'null'}`);

          const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

          if (!serverSettings) {
            const errorMsg = 'Epicor server configuration not found';
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
          }

          this.logger.log(`Epicor server settings - baseAPI: ${serverSettings.serverBaseAPI}, companyID: ${serverSettings.companyID}, userAccount: ${serverSettings.userAccount}`);

          if (serverSettings.password === undefined) {
            serverSettings.password = '';
            this.logger.log('Password was undefined, set to empty string');
          }

          // Prepare update data
          const updateData = {
            ELIEInvoice: true,
            ELIEInvStatus: 1, // 1 = SUBMITTED/SUCCESS
            ELIEInvUpdatedBy: data.drawer || 'system',
            ELIEInvException: `E-Invoice issued successfully: ${data.statusMessage}`,
            ELIEInvUpdatedOn: new Date().toISOString(),
            EInvRefNum: orderNo,
            ELIEInvID: data.serialNo, // Use serialNo as E-Invoice ID
            RowMod: 'U'
          };

          this.logger.log(`Updating invoice ${erpInvoiceId} in Epicor with data:`, JSON.stringify(updateData));

          // Update invoice with e-invoice information in Epicor
          await this.epicorService.updateInvoiceStatus(serverSettings, erpInvoiceId, updateData);

          this.logger.log(`Successfully updated invoice ${erpInvoiceId} status in Epicor`);

        } catch (configError) {
          this.logger.error(`Error getting Epicor configuration or updating invoice status: ${configError.message}`, configError.stack);
          throw configError;
        }

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
        this.logger.log(`Full error callback data: ${JSON.stringify(data)}`);

        // Try to extract erpInvoiceId from orderNo
        let erpInvoiceId: number | undefined = undefined;
        if (data.orderNo) {
          this.logger.log(`Attempting to extract erpInvoiceId from error callback orderNo: ${data.orderNo}`);
          try {
            const match = data.orderNo.match(/ORD-[a-f0-9]+-(\d+)/);
            if (match && match[1]) {
              erpInvoiceId = parseInt(match[1], 10);
              this.logger.log(`Successfully extracted erpInvoiceId: ${erpInvoiceId} from error callback`);
            } else {
              this.logger.warn(`No match found for erpInvoiceId pattern in error callback orderNo: ${data.orderNo}`);
            }
          } catch (error) {
            this.logger.error(`Error extracting erpInvoiceId from error callback orderNo: ${data.orderNo}`, error.stack);
          }
        } else {
          this.logger.error('OrderNo is missing from error callback data');
        }

        if (erpInvoiceId) {
          this.logger.log(`Updating invoice ${erpInvoiceId} with error status in Epicor`);

          // Get Epicor configuration
          const tenantId = 'default'; // This should be enhanced to get the correct tenant

          try {
            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice');
            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

            if (serverSettings) {
              this.logger.log(`Retrieved Epicor config for error update - baseAPI: ${serverSettings.serverBaseAPI}`);

              if (serverSettings.password === undefined) {
                serverSettings.password = '';
              }

              const errorUpdateData = {
                ELIEInvoice: true,
                ELIEInvStatus: 2, // 2 = ERROR
                ELIEInvUpdatedBy: 'system',
                ELIEInvException: `E-Invoice error: ${data.statusMessage || data.errorMessage || 'Unknown error'}`,
                ELIEInvUpdatedOn: new Date().toISOString(),
                EInvRefNum: data.orderNo,
                RowMod: 'U'
              };

              this.logger.log(`Updating invoice ${erpInvoiceId} with error data:`, JSON.stringify(errorUpdateData));

              await this.epicorService.updateInvoiceStatus(serverSettings, erpInvoiceId, errorUpdateData);

              this.logger.log(`Successfully updated invoice ${erpInvoiceId} with error status in Epicor`);
            } else {
              this.logger.error('No Epicor server settings found for error callback processing');
            }
          } catch (updateError) {
            this.logger.error(`Failed to update invoice ${erpInvoiceId} with error status in Epicor: ${updateError.message}`, updateError.stack);
          }
        } else {
          this.logger.warn('Could not extract erpInvoiceId from error callback, skipping Epicor update');
        }

        return {
          success: false,
          message: 'Invoice status update failed',
          error: data.statusMessage || data.errorMessage || 'Unknown error'
        };
      }
    } catch (error) {
      this.logger.error(`Error processing callback: ${error.message}`, error.stack);
      this.logger.error(`Original callback data that caused error: ${JSON.stringify(callbackData)}`);
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

      // Process each invoice directly (no grouping needed with new API structure)
      const savedInvoices: Array<{ erpInvoiceId: number; status: string }> = [];
      for (const epicorInvoice of epicorResponse.value as unknown as EpicorInvoiceHeader[]) {
        try {
          // Check if invoice already exists
          const existingInvoice = await this.invoiceRepository.findOne({
            where: { erpInvoiceId: epicorInvoice.InvoiceNum },
          });

          if (existingInvoice) {
            this.logger.log(`Invoice ${epicorInvoice.InvoiceNum} already exists. Skipping.`);
            continue;
          }

          // 创建发票记录
          const invoice = this.invoiceRepository.create({
            erpInvoiceId: epicorInvoice.InvoiceNum,
            erpInvoiceDescription: epicorInvoice.Description || '',
            fapiaoType: epicorInvoice.CNTaxInvoiceType?.toString() || '',
            customerName: epicorInvoice.CustomerName || '',
            customerResaleId: epicorInvoice.CustNum?.toString() || '',
            invoiceComment: epicorInvoice.InvoiceComment || '',
            orderNumber: epicorInvoice.OrderNum?.toString() || '',
            orderDate: epicorInvoice.InvoiceDate ? new Date(epicorInvoice.InvoiceDate) : null,
            poNumber: epicorInvoice.PONum || '',
            status: 'PENDING',
          });

          const savedInvoice = await this.invoiceRepository.save(invoice);

          // 创建发票明细
          const invoiceDetails = (epicorInvoice.InvcDtls || []).map(detailRaw => this.invoiceDetailRepository.create({
            invoiceId: savedInvoice.id,
            erpInvoiceId: detailRaw.InvoiceNum,
            lineDescription: detailRaw.LineDesc || '',
            commodityCode: detailRaw.CommodityCode || '',
            uomDescription: detailRaw.IUM || '',
            salesUm: detailRaw.SalesUM || '',
            sellingShipQty: parseFloat(detailRaw.SellingShipQty || "0") || 0,
            docUnitPrice: parseFloat(detailRaw.DocUnitPrice || "0") || 0,
            docExtPrice: parseFloat(detailRaw.DocExtPrice || "0") || 0,
            taxPercent: parseFloat(detailRaw.TaxPercent || "0") || 0,
          }));

          await this.invoiceDetailRepository.save(invoiceDetails);

          savedInvoices.push({
            erpInvoiceId: savedInvoice.erpInvoiceId,
            status: 'CREATED',
          });
        } catch (error) {
          this.logger.error(`Error processing invoice ${epicorInvoice.InvoiceNum} during resync: ${error.message}`, error.stack);
        }
      }

      return {
        success: true,
        message: `Synced ${savedInvoices.length} invoices from Epicor`,
        data: savedInvoices,
      };
    } catch (error) {
      this.logger.error(`Error syncing from Epicor: ${error.message}`, error.stack);
      throw error;
    }
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

      const { erpInvoiceIds, submittedBy } = mergeDto;
      this.logger.log(`Merging invoices: ${erpInvoiceIds.join(', ')} by ${submittedBy}`);

      if (!erpInvoiceIds.length) {
        throw new Error('At least one invoice ID must be provided');
      }

      // 使用新的Epicor Kinetic API一次性获取所有要合并的发票
      // 构建过滤条件：InvoiceNum eq 1 or InvoiceNum eq 101 or ...
      const filterConditions = erpInvoiceIds.map(id => `InvoiceNum eq ${id}`).join(' or ');

      this.logger.log(`Fetching invoices with filter: ${filterConditions}`);

      const url = `${serverSettings.serverBaseAPI}/Erp.BO.ARInvoiceSvc/ARInvoices?$expand=InvcDtls&$filter=${encodeURIComponent(filterConditions)}`;

      const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${serverSettings.userAccount}:${serverSettings.password || ''}`).toString('base64')}`,
      };

      const response = await lastValueFrom(
        this.httpService.get(url, { headers })
      );

      const invoicesData = response.data;
      if (!invoicesData || !invoicesData.value || !Array.isArray(invoicesData.value)) {
        throw new Error('Invalid response from Epicor API');
      }

      const invoices = invoicesData.value as EpicorInvoiceHeader[];

      // 验证是否找到了所有请求的发票
      const foundInvoiceIds = invoices.map(inv => inv.InvoiceNum);
      const missingInvoiceIds = erpInvoiceIds.filter(id => !foundInvoiceIds.includes(id));

      if (missingInvoiceIds.length > 0) {
        throw new Error(`Invoices not found in Epicor: ${missingInvoiceIds.join(', ')}`);
      }

      // 验证所有发票是否属于同一客户
      const firstCustomer = invoices[0].CustomerName;
      const firstCustomerNum = invoices[0].CustNum;
      for (const invoice of invoices) {
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

      // 收集所有发票明细
      let allDetails: any[] = [];
      for (const invoice of invoices) {
        if (invoice.InvcDtls && invoice.InvcDtls.length > 0) {
          allDetails = [...allDetails, ...invoice.InvcDtls];
        }
      }

      if (!allDetails.length) {
        throw new Error('No invoice details found for the selected invoices');
      }

      // 合并类似商品行 - 需要适配Epicor数据结构
      const mergedItems = this.mergeEpicorInvoiceDetails(allDetails);

      // 计算合并后的总金额
      const totalAmount = mergedItems.reduce((sum, item) => sum + Number(item.goodsTotalPrice), 0);

      // 生成订单号，包含所有发票ID以便回调时识别
      const orderNo = `MERGE-${uuidv4().substring(0, 8)}-${erpInvoiceIds.join('-')}`;

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
      const result = await this.baiwangService.submitInvoice(baiwangRequest);

      // 更新所有发票状态在Epicor中
      for (const invoice of invoices) {
        try {
          await this.epicorService.updateInvoiceStatus(serverSettings, invoice.InvoiceNum, {
            ELIEInvoice: true,
            ELIEInvStatus: 0, // 0 = PENDING
            ELIEInvUpdatedBy: submittedBy,
            ELIEInvException: `Merged with invoices: ${erpInvoiceIds.filter(id => id !== invoice.InvoiceNum).join(', ')}`,
            ELIEInvUpdatedOn: new Date().toISOString(),
            EInvRefNum: orderNo,
            RowMod: 'U'
          });
        } catch (error) {
          this.logger.error(`Could not update invoice ${invoice.InvoiceNum} status in Epicor: ${error.message}`);
        }
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

        // Get Epicor configuration
        const tenantId = 'default'; // This should be enhanced to get the correct tenant
        const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice');
        const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

        if (!serverSettings) {
          throw new Error('Epicor server configuration not found');
        }

        if (serverSettings.password === undefined) {
          serverSettings.password = '';
        }

        // 更新所有发票的电子发票信息在Epicor中
        for (const id of erpInvoiceIds) {
          try {
            await this.epicorService.updateInvoiceStatus(serverSettings, id, {
              ELIEInvoice: true,
              ELIEInvStatus: 1, // 1 = SUBMITTED/SUCCESS
              ELIEInvUpdatedBy: data.drawer || 'system',
              ELIEInvException: `E-Invoice issued successfully for merged invoices: ${erpInvoiceIds.join(', ')}`,
              ELIEInvUpdatedOn: new Date().toISOString(),
              EInvRefNum: orderNo,
              ELIEInvID: data.serialNo, // Use serialNo as E-Invoice ID
              RowMod: 'U'
            });
          } catch (error) {
            this.logger.error(`Could not update invoice with ID ${id} in Epicor: ${error.message}`);
          }
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

          // 更新所有相关发票的状态在Epicor中
          if (erpInvoiceIds.length) {
            // Get Epicor configuration
            const tenantId = 'default'; // This should be enhanced to get the correct tenant
            const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice');
            const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

            if (serverSettings) {
              if (serverSettings.password === undefined) {
                serverSettings.password = '';
              }

              for (const id of erpInvoiceIds) {
                try {
                  await this.epicorService.updateInvoiceStatus(serverSettings, id, {
                    ELIEInvoice: true,
                    ELIEInvStatus: 2, // 2 = ERROR
                    ELIEInvUpdatedBy: 'system',
                    ELIEInvException: `Error in merged invoice: ${data.statusMessage}`,
                    ELIEInvUpdatedOn: new Date().toISOString(),
                    EInvRefNum: orderNo,
                    RowMod: 'U'
                  });
                } catch (error) {
                  this.logger.error(`Could not update invoice with ID ${id} in Epicor: ${error.message}`);
                }
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
   * 合并类似的发票明细行 (Epicor数据结构)
   * @param details Epicor发票明细列表
   * @returns 合并后的百望发票明细列表
   */
  private mergeEpicorInvoiceDetails(details: any[]): any[] {
    // 用于存储合并后的商品行，键为商品代码+单价+税率
    const mergedMap: Record<string, any> = {};

    for (const detail of details) {
      // 创建唯一键 - 使用Epicor字段名
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
   * 合并类似的发票明细行 (本地数据库结构) - 保留用于向后兼容
   * @param details 发票明细列表
   * @returns 合并后的百望发票明细列表
   */
  private mergeInvoiceDetails(details: InvoiceDetail[]): any[] {
    // Implementation of the method
    // This method is kept for backward compatibility
    // It should be implemented to merge details based on local database structure
    throw new Error('Method not implemented');
  }

  /**
   * 删除所有发票数据并重新同步
   * @param tenantId 租户ID
   * @param authorization Authorization header
   * @returns 操作结果
   */
  async cleanupAndResync(tenantId?: string, authorization?: string): Promise<any> {
    try {
      this.logger.log('Starting database cleanup and resync');

      // 1. 删除所有发票明细
      const deletedDetails = await this.invoiceDetailRepository
        .createQueryBuilder()
        .delete()
        .execute();

      // 2. 删除所有发票
      const deletedInvoices = await this.invoiceRepository
        .createQueryBuilder()
        .delete()
        .execute();

      this.logger.log(`Deleted ${deletedInvoices.affected || 0} invoices and ${deletedDetails.affected || 0} invoice details`);

      // 3. 重新同步数据
      let syncResult;
      if (tenantId && authorization) {
        // 如果提供了租户ID和授权，使用Epicor直接获取数据
        this.logger.log('Syncing directly from Epicor with tenant configuration');

        const appConfig = await this.tenantConfigService.getAppConfig(tenantId, 'einvoice', authorization);
        const serverSettings = appConfig?.settings?.serverSettings as EpicorTenantConfig;

        if (!serverSettings || !serverSettings.serverBaseAPI || !serverSettings.companyID || !serverSettings.userAccount) {
          throw new Error('Epicor server configuration is incomplete');
        }

        if (serverSettings.password === undefined) {
          serverSettings.password = '';
        }

        // 使用更大的数据量获取发票
        const epicorData = await this.epicorService.fetchAllInvoicesFromBaq(
          serverSettings,
          { top: 1000 } // 获取更多数据
        );

        const epicorInvoicesRaw = epicorData.value || [];

        // Process each invoice directly (no grouping needed with new API structure)
        const savedInvoices: Array<{ erpInvoiceId: number; status: string }> = [];
        for (const epicorInvoice of epicorInvoicesRaw as unknown as EpicorInvoiceHeader[]) {
          try {
            // Check if invoice already exists
            const existingInvoice = await this.invoiceRepository.findOne({
              where: { erpInvoiceId: epicorInvoice.InvoiceNum },
            });

            if (existingInvoice) {
              this.logger.log(`Invoice ${epicorInvoice.InvoiceNum} already exists. Skipping.`);
              continue;
            }

            // 创建发票记录
            const invoice = this.invoiceRepository.create({
              erpInvoiceId: epicorInvoice.InvoiceNum,
              erpInvoiceDescription: epicorInvoice.Description || '',
              fapiaoType: epicorInvoice.CNTaxInvoiceType?.toString() || '',
              customerName: epicorInvoice.CustomerName || '',
              customerResaleId: epicorInvoice.CustNum?.toString() || '',
              invoiceComment: epicorInvoice.InvoiceComment || '',
              orderNumber: epicorInvoice.OrderNum?.toString() || '',
              orderDate: epicorInvoice.InvoiceDate ? new Date(epicorInvoice.InvoiceDate) : null,
              poNumber: epicorInvoice.PONum || '',
              status: 'PENDING',
            });

            const savedInvoice = await this.invoiceRepository.save(invoice);

            // 创建发票明细
            const invoiceDetails = (epicorInvoice.InvcDtls || []).map(detailRaw => this.invoiceDetailRepository.create({
              invoiceId: savedInvoice.id,
              erpInvoiceId: detailRaw.InvoiceNum,
              lineDescription: detailRaw.LineDesc || '',
              commodityCode: detailRaw.CommodityCode || '',
              uomDescription: detailRaw.IUM || '',
              salesUm: detailRaw.SalesUM || '',
              sellingShipQty: parseFloat(detailRaw.SellingShipQty || "0") || 0,
              docUnitPrice: parseFloat(detailRaw.DocUnitPrice || "0") || 0,
              docExtPrice: parseFloat(detailRaw.DocExtPrice || "0") || 0,
              taxPercent: parseFloat(detailRaw.TaxPercent || "0") || 0,
            }));

            await this.invoiceDetailRepository.save(invoiceDetails);

            savedInvoices.push({
              erpInvoiceId: savedInvoice.erpInvoiceId,
              status: 'CREATED',
            });
          } catch (error) {
            this.logger.error(`Error processing invoice ${epicorInvoice.InvoiceNum} during resync: ${error.message}`, error.stack);
          }
        }

        syncResult = {
          source: 'epicor',
          importedCount: savedInvoices.length,
          invoices: savedInvoices
        };
      } else {
        // 否则使用标准同步接口
        this.logger.log('Using standard sync method');
        syncResult = await this.syncFromEpicor();
      }

      return {
        success: true,
        message: 'Database cleanup and resync completed successfully',
        deletedData: {
          invoices: deletedInvoices.affected || 0,
          details: deletedDetails.affected || 0
        },
        syncResult
      };
    } catch (error) {
      this.logger.error(`Error during cleanup and resync: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get einvoice application configuration
   * @param tenantId Tenant ID
   * @param authorization Authorization header
   * @param mode Configuration mode (merge or standalone)
   * @param appCode Application code
   * @returns Application configuration
   */
  async getConfig(
    tenantId: string,
    authorization?: string,
    mode: 'merge' | 'standalone' = 'merge',
    appCode: string = 'einvoice'
  ): Promise<any> {
    this.logger.log(`Getting config for app: ${appCode} with mode: ${mode} for tenant: ${tenantId}`);
    try {
      // Get the customer portal URL from the configuration service
      const customerPortalUrl = this.configService.get<string>(
        'CUSTOMER_PORTAL_URL',
        'http://localhost:3000'
      );

      if (!authorization) {
        throw new Error('No authorization header provided');
      }

      // Call the customer portal's app-config endpoint directly with mode parameter
      const response = await lastValueFrom(
        this.httpService.get(
          `${customerPortalUrl}/app-config?appcode=${appCode}&mode=${mode}`,
          {
            headers: {
              Authorization: authorization,
            },
          }
        )
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get config: ${error.message}`, error.stack);
      // Provide a default configuration in case of error
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
            appSecret: "223998c6-5b76-4724-b5c9-666ff4215b45",
            connector: "CN - BW",
            userAccount: "admin_3sylog6ryv8cs"
          }
        }
      };
    }
  }

  /**
   * Update einvoice application configuration
   * @param tenantId Tenant ID
   * @param settingsData Configuration data to update
   * @param authorization Authorization header
   * @param appCode Application code
   * @returns Updated configuration
   */
  async updateConfig(
    tenantId: string,
    settingsData: Record<string, any>,
    authorization?: string,
    appCode: string = 'einvoice'
  ): Promise<any> {
    this.logger.log(`Updating config for app: ${appCode} for tenant: ${tenantId}`);
    try {
      // Get the customer portal URL from the configuration service
      const customerPortalUrl = this.configService.get<string>(
        'CUSTOMER_PORTAL_URL',
        'http://localhost:3000'
      );

      if (!authorization) {
        throw new Error('No authorization header provided');
      }

      // Call the customer portal's app-config endpoint to update the settings
      const response = await lastValueFrom(
        this.httpService.post(
          `${customerPortalUrl}/app-config?appcode=${appCode}`,
          settingsData,
          {
            headers: {
              Authorization: authorization
            }
          }
        )
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to update config: ${error.message}`, error.stack);
      throw error;
    }
  }
}
