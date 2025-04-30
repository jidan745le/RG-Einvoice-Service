import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseCleanupService } from './database-cleanup.service';
import { Invoice } from '../invoice/entities/invoice.entity';
import { InvoiceDetail } from '../invoice/entities/invoice-detail.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Invoice, InvoiceDetail]),
    ],
    providers: [DatabaseCleanupService],
    exports: [DatabaseCleanupService],
})
export class DatabaseCleanupModule { } 