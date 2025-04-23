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
}
