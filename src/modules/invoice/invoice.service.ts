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
  ) {}

  /**
   * Create a new invoice
   * @param createInvoiceDto Invoice data
   * @returns Created invoice
   */
  async create(createInvoiceDto: CreateInvoiceDto): Promise<Invoice> {
    const { details, ...invoiceData } = createInvoiceDto;
    
    // Create invoice
    const invoice = this.invoiceRepository.create({
      ...invoiceData,
      status: 'PENDING',
    });
    
    const savedInvoice = await this.invoiceRepository.save(invoice);
    
    // Create invoice details if provided
    if (details && details.length > 0) {
      const invoiceDetails = details.map(detail => this.invoiceDetailRepository.create({
        ...detail,
        invoiceId: savedInvoice.id,
        erpInvoiceId: savedInvoice.erpInvoiceId,
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
      const startDateFilter = 'invoice.postDate >= :startDate';
      queryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
      statusQueryBuilder.andWhere(startDateFilter, { startDate: filters.startDate });
    }
    
    if (filters.endDate) {
      const endDateFilter = 'invoice.postDate <= :endDate';
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
      where: {erpInvoiceId: id },
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
    await this.invoiceRepository.update(id, invoiceData);
    
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
   * @returns Result of submission
   */
  async submitInvoice(id: number, submittedBy: string): Promise<any> {
    try {
      // Get invoice and details
      const invoice = await this.findOne(id);
      const details = await this.invoiceDetailRepository.find({ where: { invoice: {
        erpInvoiceId: id
      } } });
      
      if (!details.length) {
        throw new Error('Cannot submit invoice without details');
      }
      
      // Generate order number using UUID (shortened)
      const orderNo = `ORD-${uuidv4().substring(0, 8)}-${Date.now()}`;
      
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
        invoiceDetailList,
        sellerAddress: 'Environment issue immediately',
        buyerAddress: 'Test address',
        buyerBankName: 'Test bank name',
        invoiceType: '1',
        taxNo: '338888888888SMB',
        orderDateTime: new Date().toISOString().split('T')[0] + ' 10:00:00',
        orderNo,
        buyerName: invoice.customerName || 'Test Company',
        invoiceTypeCode: '02',
        sellerBankName: 'Test Bank',
        remarks: invoice.invoiceComment || 'Invoice',
      };
      
      // Submit to Baiwang
      const result = await this.baiwangService.submitInvoice(baiwangRequest);
      
      // Update invoice status and submitter
      await this.invoiceRepository.update(id, {
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
    
    // For now, just log the data
    // In a real implementation, we would update the invoice status, e-invoice ID, PDF URL, etc.
    
    return {
      success: true,
      message: 'Callback processed successfully',
      data: callbackData,
    };
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
            orderNumber: firstInvoice.OrderHed_OrderNum,
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
}
