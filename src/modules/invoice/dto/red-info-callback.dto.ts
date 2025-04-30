import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RedInfoDetailDto {
    @IsString()
    goodsName: string;

    @IsOptional()
    @IsString()
    goodsSimpleName?: string;

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
    deductibleAmount?: string;

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

export class RedInfoCallbackDataDto {
    @IsString()
    redInfoSerialNo: string;

    @IsString()
    orderNo: string;

    @IsString()
    redInfoNo: string;

    @IsString()
    redInfoStatus: string;

    @IsString()
    redInfoMessage: string;

    @IsString()
    redInfoType: string;

    @IsString()
    invoiceTypeCode: string;

    @IsOptional()
    @IsString()
    invoiceSpecialMark?: string;

    @IsString()
    applyType: string;

    @IsString()
    entryTime: string;

    @IsString()
    invoiceTotalPrice: string;

    @IsString()
    invoiceTotalTax: string;

    @IsOptional()
    @IsString()
    originalInvoiceCode?: string;

    @IsOptional()
    @IsString()
    originalInvoiceNo?: string;

    @IsString()
    taxNo: string;

    @IsString()
    sellerName: string;

    @IsOptional()
    @IsString()
    buyerTaxNo?: string;

    @IsOptional()
    @IsString()
    buyerName?: string;

    @IsOptional()
    @IsString()
    buyerAddress?: string;

    @IsOptional()
    @IsString()
    buyerTelephone?: string;

    @IsOptional()
    @IsString()
    buyerBankName?: string;

    @IsOptional()
    @IsString()
    buyerBankNumber?: string;

    @IsOptional()
    @IsString()
    invoiceTerminalCode?: string;

    @IsOptional()
    @IsString()
    machineNo?: string;

    @IsOptional()
    @IsString()
    customField1?: string;

    @IsOptional()
    @IsString()
    customField2?: string;

    @IsOptional()
    @IsString()
    customField3?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RedInfoDetailDto)
    details: RedInfoDetailDto[];
}

export class RedInfoCallbackDto {
    @IsString()
    method: string;

    @IsString()
    type: string;

    @IsString()
    taxNo: string;

    @IsString()
    version: string;

    @IsString()
    data: string;

    @IsOptional()
    @IsString()
    sign?: string;
} 