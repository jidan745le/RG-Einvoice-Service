import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authService: AuthService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
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

            return true;
        } catch (error) {
            // If error is already an HttpException with 401, just rethrow it
            if (error instanceof HttpException && error.getStatus() === HttpStatus.UNAUTHORIZED) {
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