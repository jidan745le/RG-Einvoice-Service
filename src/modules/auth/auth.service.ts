import { Injectable, Logger, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

const isDev = process.env.NODE_ENV === 'development';
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    async verifyToken(token: string): Promise<any> {
        try {
            const customerPortalUrl = isDev ? 'http://127.0.0.1:3000' : this.configService.get<string>('CUSTOMER_PORTAL_URL');

            const response = await lastValueFrom(
                this.httpService.get(`${customerPortalUrl}/verify-auth`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                })
            );

            return response.data;
        } catch (error) {
            this.logger.error(`Authentication verification failed: ${error.message}`);

            if (error.response) {
                if (error.response.status === 401) {
                    throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
                }

                throw new HttpException(
                    error.response.data?.message || 'Authentication failed',
                    error.response.status || HttpStatus.UNAUTHORIZED
                );
            }

            throw new HttpException('Authentication service unavailable', HttpStatus.UNAUTHORIZED);
        }
    }
} 