import { IsOptional, IsString, IsNumber, IsDateString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryInvoiceDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;



  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  fromEpicor?: boolean = false;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  erpInvoiceId?: number;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  eInvoiceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  fapiaoType?: string;

  @IsOptional()
  @IsString()
  submittedBy?: string;

  @IsOptional()
  @IsString()
  invoiceComment?: string;
} 