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
} from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceService } from './invoice.service';
import { RedInvoiceRequestDto } from './dto/red-invoice.dto';
import { Public } from '../auth/decorators/public.decorator';

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

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id') id: string,
    @Body('submittedBy') submittedBy: string,
  ) {
    this.logger.log(`Submitting invoice ${id} by ${submittedBy}`);
    return this.invoiceService.submitInvoice(+id, submittedBy);
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async callback(@Body() callbackData: any) {
    this.logger.log(`Received callback: ${JSON.stringify(callbackData)}`);
    return this.invoiceService.processCallback(callbackData);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncFromEpicor() {
    this.logger.log('Starting sync from Epicor');
    return this.invoiceService.syncFromEpicor();
  }

  /**
   * Submit red invoice request
   * @param id Original invoice ID
   * @param submittedBy User who submitted the red invoice
   * @returns Result of red invoice submission
   */
  @Post(':id/red')
  async submitRedInvoice(
    @Param('id') id: string,
    @Body('submittedBy') submittedBy: string,
  ) {
    return this.invoiceService.submitRedInvoice(parseInt(id), submittedBy);
  }

  @Post(':id/red/callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async redCallback(@Body() callbackData: any) {
    return this.invoiceService.processRedInfoCallback(callbackData);
  }
}
