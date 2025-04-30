import { IsOptional, IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RedInvoiceDetailDto {
    @IsOptional()
    @IsString()
    originalInvoiceDetailNo?: string;

    @IsString()
    goodsName: string;

    @IsString()
    goodsCode: string;

    @IsOptional()
    @IsString()
    goodsQuantity?: string;

    @IsOptional()
    @IsString()
    goodsPrice?: string;

    @IsString()
    goodsTaxRate: string;

    @IsString()
    goodsTotalPrice: string;

    @IsString()
    goodsTotalTax: string;

    @IsOptional()
    @IsString()
    goodsSpecification?: string;

    @IsOptional()
    @IsString()
    goodsUnit?: string;

    @IsOptional()
    @IsString()
    freeTaxMark?: string;

    @IsOptional()
    @IsString()
    preferentialMark?: string;

    @IsOptional()
    @IsString()
    vatSpecialManagement?: string;
}

export class RedInvoiceRequestDto {
    @IsOptional()
    @IsString()
    originalSerialNo?: string;

    @IsOptional()
    @IsString()
    originalOrderNo?: string;

    @IsOptional()
    @IsString()
    originalInvoiceCode?: string;

    @IsOptional()
    @IsString()
    originalInvoiceNo?: string;

    @IsOptional()
    @IsString()
    originalDigitInvoiceNo?: string;

    @IsOptional()
    @IsString()
    invoiceTypeCode?: string;

    @IsOptional()
    @IsString()
    fastIssueRedType?: string;

    @IsOptional()
    @IsString()
    redInvoiceLabel?: string;

    @IsOptional()
    @IsString()
    entryIdentity?: string;

    @IsOptional()
    @IsString()
    applyType?: string;

    @IsOptional()
    @IsString()
    pushEmail?: string;

    @IsOptional()
    @IsString()
    pushPhone?: string;

    @IsOptional()
    @IsString()
    drawerId?: string;

    @IsOptional()
    @IsString()
    orgId?: string;

    @IsOptional()
    @IsString()
    callBackUrl?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RedInvoiceDetailDto)
    details?: RedInvoiceDetailDto[];

    @IsString()
    submittedBy: string;
} 