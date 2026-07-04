import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';

/**
 * Build the CORS origin allowlist. Browser origins are read from `CORS_ORIGINS`
 * (comma-separated, e.g. `https://app.example.com,https://admin.example.com`).
 * When unset — local development — only localhost web origins are allowed. The
 * API is never opened to `*`; server-to-server calls (which send no Origin
 * header) are unaffected, since CORS only governs browser origins.
 */
function corsOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured && configured.length) return configured;
  return ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Versioned API base path (Design Doc 7 §2.2); health stays unprefixed.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
  await app.listen(port);
  console.log(`[api] RMC API listening on http://localhost:${port} (health: /health)`);
}

void bootstrap();
