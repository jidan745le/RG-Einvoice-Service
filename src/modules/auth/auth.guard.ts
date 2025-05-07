import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
        private readonly configService: ConfigService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const authorization = request.headers.authorization;

        if (!authorization) {
            throw new HttpException('Not logged in', HttpStatus.UNAUTHORIZED);
        }

        try {
            const token = authorization.split(' ')[1];

            if (!token) {
                throw new HttpException('Invalid authorization format', HttpStatus.UNAUTHORIZED);
            }

            // Verify token with the customer portal service
            const authData = await this.authService.verifyToken(token);

            // Add user data to request object for controllers to use
            request.user = authData.user;

            // Get current application identifier from config
            const currentAppId = this.configService.get<string>('APP_ID', 'einvoice');

            // Check if user has access to this application
            if (request.user.subApplications &&
                Array.isArray(request.user.subApplications) &&
                !request.user.subApplications.includes(currentAppId)) {
                throw new HttpException('Access to this application is forbidden', HttpStatus.FORBIDDEN);
            }

            return true;
        } catch (error) {
            // If error is already an HttpException, just rethrow it
            if (error instanceof HttpException) {
                throw error;
            }

            // Otherwise, create a new 401 HttpException
            throw new HttpException(
                error.message || 'Authentication failed',
                HttpStatus.UNAUTHORIZED
            );
        }
    }
} 