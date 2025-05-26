import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { BaiwangModule } from '../baiwang/baiwang.module';
import { EpicorModule } from '../epicor/epicor.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthorizationCacheService } from './authorization-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail]),
    HttpModule,
    BaiwangModule,
    EpicorModule,
    TenantModule,
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService, AuthorizationCacheService],
  exports: [InvoiceService],
})
export class InvoiceModule { }
