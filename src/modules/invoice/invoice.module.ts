import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { BaiwangModule } from '../baiwang/baiwang.module';
import { EpicorModule } from '../epicor/epicor.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthorizationCacheService } from './authorization-cache.service';
import { InvoiceCacheService } from './services/invoice-cache.service';
import { InvoiceQueryService } from './services/invoice-query.service';
import { InvoiceOperationService } from './services/invoice-operation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail]),
    ScheduleModule.forRoot(), // Enable scheduling for cron jobs
    HttpModule,
    BaiwangModule,
    EpicorModule,
    TenantModule,
  ],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    AuthorizationCacheService,
    InvoiceCacheService,
    InvoiceQueryService,
    InvoiceOperationService,
  ],
  exports: [
    InvoiceService,
    AuthorizationCacheService,
    InvoiceCacheService,
    InvoiceQueryService,
    InvoiceOperationService,
  ],
})
export class InvoiceModule { }
