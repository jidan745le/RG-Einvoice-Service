import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TenantConfigService } from './tenant-config.service';
import { CustomerHubRpcService } from './customer-hub-rpc.service';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
    ],
    providers: [
        TenantConfigService,
        CustomerHubRpcService,
    ],
    exports: [
        TenantConfigService,
        CustomerHubRpcService,
    ],
})
export class TenantModule { } 