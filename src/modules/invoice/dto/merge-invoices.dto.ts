import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class MergeInvoicesDto {
    @IsNotEmpty()
    @IsArray()
    erpInvoiceIds: number[];

    @IsNotEmpty()
    @IsString()
    submittedBy: string;
} 