import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BaiwangService } from './baiwang.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  providers: [BaiwangService],
  exports: [BaiwangService],
})
export class BaiwangModule {}
