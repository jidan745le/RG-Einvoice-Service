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
} from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceService } from './invoice.service';
import { RedInvoiceRequestDto } from './dto/red-invoice.dto';
import { Public } from '../auth/decorators/public.decorator';
import { MergeInvoicesDto } from './dto/merge-invoices.dto';
import { Request } from 'express';

// 扩展 Request 类型以包含 user 属性
interface RequestWithUser extends Request {
  user?: {
    id?: string;
    tenantId?: string;
    [key: string]: any;
  };
}

@Controller("invoice")
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(private readonly invoiceService: InvoiceService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  async findAll(@Query() queryDto: QueryInvoiceDto) {
    return this.invoiceService.findAll(queryDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.invoiceService.findOne(+id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(+id, updateInvoiceDto);
  }

  /**
   * Submit invoice for e-invoicing
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
    const tenantId = request.user?.tenantId || 'default';
    const authorization = request.headers.authorization;
    this.logger.log(`Submitting invoice ${id} by ${submittedBy} for tenant ${tenantId}`);
    return this.invoiceService.submitInvoice(+id, submittedBy, tenantId, authorization);
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async callback(@Body() callbackData: any) {
    this.logger.log(`Received callback: ${JSON.stringify(callbackData)}`);
    return this.invoiceService.processCallback(callbackData);
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
   * Merge multiple invoices for the same customer
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
    return this.invoiceService.mergeAndSubmitInvoices(mergeDto, tenantId, authorization);
  }
}
