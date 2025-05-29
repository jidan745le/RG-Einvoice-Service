import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceService } from './invoice.service';
import { InvoiceQueryService } from './services/invoice-query.service';
import { InvoiceOperationService } from './services/invoice-operation.service';
import { InvoiceCacheService } from './services/invoice-cache.service';
import { RedInvoiceRequestDto } from './dto/red-invoice.dto';
import { Public } from '../auth/decorators/public.decorator';
import { MergeInvoicesDto } from './dto/merge-invoices.dto';
import { Request } from 'express';

// 扩展 Request 类型以包含 user 属性
interface RequestWithUser extends Request {
  user?: {
    id?: string;
    tenantId?: string;
    tenant?: {
      id?: string;
    };
    [key: string]: any;
  };
}

@Controller("invoice")
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService, // Keep for config and legacy operations
    private readonly invoiceQueryService: InvoiceQueryService, // New caching query service
    private readonly invoiceOperationService: InvoiceOperationService, // New operations service
    private readonly invoiceCacheService: InvoiceCacheService, // Cache service for direct access
  ) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  async findAll(@Query() queryDto: QueryInvoiceDto, @Req() request: RequestWithUser) {
    const tenantId = request.user?.tenant?.id;
    const authorization = request.headers.authorization;

    // If trying to fetch from Epicor, ensure both tenantId and authorization are available
    if (queryDto.fromEpicor === true) {
      console.log(authorization, tenantId, 'authorization, tenantId');
      if (!tenantId || !authorization) {
        this.logger.error('Tenant ID and Authorization are required when fromEpicor is true');
        throw new BadRequestException('Tenant ID and Authorization are required for fetching from Epicor');
      }
    } else if (!tenantId) {
      // For non-Epicor queries, just log a warning if tenantId is missing
      this.logger.warn('Tenant ID not found in request for findAll');
    }
    console.log(tenantId, JSON.stringify(request.user), 'tenantId');
    // Use the new caching-aware query service
    return this.invoiceQueryService.findAll(queryDto, tenantId, authorization);
  }

  /**
   * Get einvoice application configuration
   * @param mode Optional configuration mode (merge or standalone)
   * @param appcode Application code (defaults to 'einvoice')
   * @returns Application configuration
   */
  @Get('app-config')
  @HttpCode(HttpStatus.OK)
  async getAppConfig(
    @Req() request: RequestWithUser,
    @Query('mode') mode?: 'merge' | 'standalone',
    @Query('appcode') appcode?: string,
  ) {
    try {
      const tenantId = request.user?.tenantId || request.user?.tenant?.id;
      const authorization = request.headers.authorization;

      if (!tenantId) {
        throw new HttpException('Invalid authentication - tenant ID not found', HttpStatus.UNAUTHORIZED);
      }

      // Default to merge mode if not specified
      const configMode = mode || 'merge';
      // Use einvoice as default app code if not specified
      const appCode = appcode || 'einvoice';

      this.logger.log(`Getting config for app: ${appCode} with mode ${configMode} for tenant ${tenantId}`);
      return this.invoiceService.getConfig(tenantId, authorization, configMode, appCode);
    } catch (error) {
      this.logger.error(`Failed to get config: ${error.message}`, error.stack);
      throw new HttpException(
        error.message || 'Failed to retrieve application configuration',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update einvoice application configuration
   * @param settingsData Configuration data to update
   * @param appcode Application code (defaults to 'einvoice')
   * @returns Updated configuration
   */
  @Post('app-config')
  @HttpCode(HttpStatus.OK)
  async updateAppConfig(
    @Body() settingsData: Record<string, any>,
    @Req() request: RequestWithUser,
    @Query('appcode') appcode?: string,
  ) {
    try {
      const tenantId = request.user?.tenantId || request.user?.tenant?.id;
      const authorization = request.headers.authorization;

      if (!tenantId) {
        throw new HttpException('Invalid authentication - tenant ID not found', HttpStatus.UNAUTHORIZED);
      }

      if (!settingsData || typeof settingsData !== 'object') {
        throw new HttpException('Invalid settings data', HttpStatus.BAD_REQUEST);
      }

      // Use einvoice as default app code if not specified
      const appCode = appcode || 'einvoice';

      this.logger.log(`Updating config for app: ${appCode} for tenant ${tenantId}`);
      return this.invoiceService.updateConfig(tenantId, settingsData, authorization, appCode);
    } catch (error) {
      this.logger.error(`Failed to update config: ${error.message}`, error.stack);
      throw new HttpException(
        error.message || 'Failed to update application configuration',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // Use the operation service for single invoice queries
    return this.invoiceOperationService.findOne(+id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(+id, updateInvoiceDto);
  }

  /**
   * Submit invoice for e-invoicing - Now uses the new operation service
   * @param id Invoice ID
   * @param submittedBy User who submitted the invoice
   * @returns Result of submission
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submitInvoice(
    @Param('id') id: number,
    @Body('submittedBy') submittedBy: string,
    @Req() request: RequestWithUser
  ) {
    // 从请求中获取租户ID和认证头
    const tenantId = request.user?.tenantId || request.user?.tenant?.id || 'default';
    const authorization = request.headers.authorization;
    this.logger.log(`Submitting invoice ${id} by ${submittedBy} for tenant ${tenantId}`);

    // Use the new operation service
    return this.invoiceOperationService.submitInvoice(+id, submittedBy, tenantId, authorization);
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async callback(@Body() callbackData: any) {
    this.logger.log(`Received callback: ${JSON.stringify(callbackData)}`);
    return this.invoiceOperationService.processCallback(callbackData);
  }

  @Post('sync')
  @Public()
  @HttpCode(HttpStatus.OK)
  async syncFromEpicor() {
    this.logger.log('Starting sync from Epicor');
    return this.invoiceService.syncFromEpicor();
  }

  /**
   * Submit red invoice for e-invoicing
   * @param id Original invoice ID
   * @param submittedBy User who submitted the red invoice
   * @returns Result of red invoice submission
   */
  @Post(':id/red')
  @HttpCode(HttpStatus.OK)
  async submitRedInvoice(
    @Param('id') id: number,
    @Body('submittedBy') submittedBy: string,
    @Req() request: RequestWithUser
  ) {
    // 从请求中获取租户ID和认证头
    const tenantId = request.user?.tenantId || 'default';
    const authorization = request.headers.authorization;
    this.logger.log(`Submitting red invoice for ${id} by ${submittedBy} for tenant ${tenantId}`);
    return this.invoiceService.submitRedInvoice(+id, submittedBy, tenantId, authorization);
  }

  @Post('/red/callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async redCallback(@Body() callbackData: any) {
    return this.invoiceService.processRedInfoCallback(callbackData);
  }

  /**
   * Merge multiple invoices for the same customer - Now uses the new operation service
   * @param mergeDto DTO containing invoice IDs to merge and submitter
   * @returns Result of merge and submission
   */
  @Post('/merge')
  @HttpCode(HttpStatus.OK)
  async mergeInvoices(
    @Body() mergeDto: MergeInvoicesDto,
    @Req() request: RequestWithUser
  ) {
    // 从请求中获取租户ID和认证头
    const tenantId = request.user?.tenantId || 'default';
    const authorization = request.headers.authorization;
    this.logger.log(`Merging invoices: ${mergeDto.erpInvoiceIds.join(', ')} by ${mergeDto.submittedBy} for tenant ${tenantId}`);

    // Use the new operation service
    return this.invoiceOperationService.mergeAndSubmitInvoices(mergeDto, tenantId, authorization);
  }

  /**
   * 清空所有发票数据并重新同步
   * @returns 清空和同步结果
   */
  @Post('/cleanup-resync')
  @HttpCode(HttpStatus.OK)
  async cleanupAndResync(@Req() request: RequestWithUser) {
    // 从请求中获取租户ID和认证头
    const tenantId = request.user?.tenantId || 'default';
    const authorization = request.headers.authorization;
    this.logger.log(`Starting database cleanup and resync for tenant ${tenantId}`);
    return this.invoiceService.cleanupAndResync(tenantId, authorization);
  }

  // ===== 新增缓存管理相关端点 =====



  /**
   * 获取缓存统计信息
   * @returns 缓存统计
   */
  @Get('/cache/stats')
  @HttpCode(HttpStatus.OK)
  async getCacheStats() {
    this.logger.log('Getting cache statistics');
    return this.invoiceQueryService.getCacheStats();
  }

  /**
   * 清理过期缓存
   * @param olderThanDays 清理多少天前的数据
   * @returns 清理结果
   */
  @Post('/cache/cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupOldCache(@Body('olderThanDays') olderThanDays: number = 30) {
    this.logger.log(`Cleaning up cache data older than ${olderThanDays} days`);
    return this.invoiceQueryService.cleanupOldCache(olderThanDays);
  }

  /**
   * 测试获取所有租户配置（调试用）
   * @returns 租户配置列表
   */
  @Get('/cache/test-tenant-configs')
  @Public()
  @HttpCode(HttpStatus.OK)
  async testTenantConfigs() {
    this.logger.log('Testing tenant configurations');
    return this.invoiceCacheService.testGetAllTenantConfigs();
  }

  /**
   * 测试RPC连接到Customer Hub
   * @returns RPC连接测试结果
   */
  @Get('/cache/test-rpc-connection')
  @HttpCode(HttpStatus.OK)
  async testRpcConnection(@Req() request: RequestWithUser) {
    const tenantId = request.user?.tenantId || request.user?.tenant?.id;
    this.logger.log(`Testing RPC connection for tenant: ${tenantId}`);
    return this.invoiceService.testRpcConnection();
  }
}
