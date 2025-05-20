import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { FileController } from './file.controller';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        MulterModule.register({
            limits: {
                fileSize: 5 * 1024 * 1024, // 5MB size limit
            },
        }),
    ],
    controllers: [FileController],
    providers: [],
})
export class FileModule { } 