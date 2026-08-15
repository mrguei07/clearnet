import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  const bridge = config.get<string>('BLOCKCHAIN_ENABLED', 'false') === 'true';
  console.log(
    `ClearNet backend ready on http://localhost:${port}/api` +
      ` | rate-limit: ${config.get<number>('THROTTLE_LIMIT', 100)} req/${config.get<number>('THROTTLE_TTL', 60000) / 1000}s` +
      ` | pont on-chain: ${bridge ? 'ON' : 'OFF'}`,
  );
}

bootstrap();
