import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { BaiwangModule } from './modules/baiwang/baiwang.module';
import { EpicorModule } from './modules/epicor/epicor.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { Invoice } from './modules/invoice/entities/invoice.entity';
import { InvoiceDetail } from './modules/invoice/entities/invoice-detail.entity';
import * as path from 'path';
import { ExcelModule } from './modules/excel/excel.module';
import { DatabaseCleanupModule } from './modules/database/database-cleanup.module';
const isDev = process.env.NODE_ENV === 'development';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.join(__dirname, '.env'),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get(isDev ? 'DB_HOST_DEV' : 'DB_HOST', 'localhost'),
        port: configService.get<number>(isDev ? 'DB_PORT_DEV' : 'DB_PORT', 3306),
        username: configService.get(isDev ? 'DB_USERNAME_DEV' : 'DB_USERNAME', 'root'),
        password: configService.get(isDev ? 'DB_PASSWORD_DEV' : 'DB_PASSWORD', '123456'),
        database: configService.get(isDev ? 'DB_DATABASE_DEV' : 'DB_DATABASE', 'einvoice'),
        entities: [Invoice, InvoiceDetail],
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE', true),
        logging: configService.get<boolean>('DB_LOGGING', false),
      }),
    }),
    InvoiceModule,
    BaiwangModule,
    EpicorModule,
    AuthModule,
    TenantModule,
    ExcelModule,
    DatabaseCleanupModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
