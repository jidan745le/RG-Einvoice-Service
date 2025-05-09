import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BaiwangService } from './baiwang.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    TenantModule,
  ],
  providers: [BaiwangService],
  exports: [BaiwangService],
})
export class BaiwangModule { }
