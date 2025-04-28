import './polyfills';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './modules/auth/auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // Get the Auth guard
  const authGuard = app.get(AuthGuard);
  app.useGlobalGuards(authGuard);

  // // Set global prefix
  // app.setGlobalPrefix('api');

  // Get configuration
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3003);

  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
}
bootstrap();
