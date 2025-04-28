import { Injectable, Logger, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    async verifyToken(token: string): Promise<any> {
        try {
            const customerPortalUrl = this.configService.get<string>(
                'CUSTOMER_PORTAL_URL',
                'http://localhost:3000'
            );

            const response = await lastValueFrom(
                this.httpService.get(`${customerPortalUrl}/api/verify-auth`, {
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