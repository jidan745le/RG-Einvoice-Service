import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { Reflector } from '@nestjs/core';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
    ],
    providers: [AuthService, AuthGuard, Reflector],
    exports: [AuthService, AuthGuard],
})
export class AuthModule { } 