import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { BaiwangModule } from './modules/baiwang/baiwang.module';
import { EpicorModule } from './modules/epicor/epicor.module';
import { AuthModule } from './modules/auth/auth.module';
import { Invoice } from './modules/invoice/entities/invoice.entity';
import { InvoiceDetail } from './modules/invoice/entities/invoice-detail.entity';
import * as path from 'path';

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
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get('DB_USERNAME', ''),
        password: configService.get('DB_PASSWORD', ''),
        database: configService.get('DB_DATABASE', ''),
        entities: [Invoice, InvoiceDetail],
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE', true),
        logging: configService.get<boolean>('DB_LOGGING', false),
      }),
    }),
    InvoiceModule,
    BaiwangModule,
    EpicorModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
