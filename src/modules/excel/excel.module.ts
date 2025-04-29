import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExcelService } from './excel.service';
import { ExcelController } from './excel.controller';
import { Invoice } from '../invoice/entities/invoice.entity';
import { InvoiceDetail } from '../invoice/entities/invoice-detail.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Invoice, InvoiceDetail])
    ],
    controllers: [ExcelController],
    providers: [ExcelService],
    exports: [ExcelService]
})
export class ExcelModule { } 