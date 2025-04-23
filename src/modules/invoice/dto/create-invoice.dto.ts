import { IsNotEmpty, IsOptional, IsString, IsNumber, IsArray, ValidateNested, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvoiceDetailDto {
  @IsOptional()
  @IsString()
  lineDescription?: string;

  @IsOptional()
  @IsString()
  commodityCode?: string;

  @IsOptional()
  @IsString()
  uomDescription?: string;

  @IsOptional()
  @IsString()
  salesUm?: string;

  @IsOptional()
  @IsNumber()
  sellingShipQty?: number;

  @IsOptional()
  @IsNumber()
  docUnitPrice?: number;

  @IsOptional()
  @IsNumber()
  docExtPrice?: number;

  @IsOptional()
  @IsNumber()
  taxPercent?: number;
}

export class CreateInvoiceDto {
  @IsNotEmpty()
  @IsNumber()
  erpInvoiceId: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  postDate?: Date;

  @IsOptional()
  @IsString()
  erpInvoiceDescription?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerResaleId?: string;

  @IsOptional()
  @IsString()
  invoiceComment?: string;

  @IsOptional()
  @IsString()
  fapiaoType?: string;

  @IsOptional()
  @IsNumber()
  invoiceAmount?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  orderNumber?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  orderDate?: Date;

  @IsOptional()
  @IsString()
  poNumber?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceDetailDto)
  details?: CreateInvoiceDetailDto[];
} 