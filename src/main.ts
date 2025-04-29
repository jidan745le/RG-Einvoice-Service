import './polyfills';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Add request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log('=== Incoming Request ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', req.headers);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    console.log('========================');
    next();
  });

  // Enable CORS
  app.enableCors();

  // Enable validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Get the Auth guard from the AuthModule
  const authGuard = app.select(AuthModule).get(AuthGuard);
  app.useGlobalGuards(authGuard);

  // // Set global prefix
  // app.setGlobalPrefix('api');

  // Get configuration
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3003);

  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
