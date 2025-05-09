import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TenantConfigService } from './tenant-config.service';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
    ],
    providers: [TenantConfigService],
    exports: [TenantConfigService],
})
export class TenantModule { } 