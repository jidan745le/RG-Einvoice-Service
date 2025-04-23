import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { EpicorService } from './epicor.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  providers: [EpicorService],
  exports: [EpicorService],
})
export class EpicorModule {}
