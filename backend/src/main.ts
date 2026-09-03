import { existsSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { DecimalInterceptor } from './common/decimal.interceptor';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Confia no primeiro proxy (load balancer / reverse proxy) para que req.ip
  // reflita o cliente real — essencial para o rate limit de login.
  app.set('trust proxy', 1);

  // Importacao de catalogo pode enviar um CSV grande no corpo.
  app.useBodyParser('json', { limit: '8mb' });

  app.setGlobalPrefix('api');
  app.use(helmet());

  // CORS restrito: lista separada por virgula em CORS_ORIGIN.
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new DecimalInterceptor());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API disponivel em http://localhost:${port}/api`);
}

bootstrap();
