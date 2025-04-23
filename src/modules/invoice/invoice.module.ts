import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { BaiwangModule } from '../baiwang/baiwang.module';
import { EpicorModule } from '../epicor/epicor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail]),
    BaiwangModule,
    EpicorModule,
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
