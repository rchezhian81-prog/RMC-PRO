import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { ErrorFilter } from './common/error.filter';
import { ErrorAlertService } from './common/error-alert.service';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Larger JSON limit so a base64 PO (PDF/image) fits the AI extract endpoint;
  // nginx caps the upstream at 25m. Non-AI payloads are tiny.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '25mb' });

  // Versioned API base path (Design Doc 7 §2.2); health, readiness and the
  // Prometheus scrape endpoint stay unprefixed (/health, /health/ready, /metrics).
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'metrics'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Structured per-request logging + correlation id are handled by
  // RequestContextMiddleware (runs before guards, so it also logs rejections).
  // Here we only wrap successful responses in the standard envelope.
  app.useGlobalInterceptors(new ResponseInterceptor());
  // Failures get the same envelope as successes, so the web client can read the
  // error code rather than guessing from the status alone. The filter also
  // raises an ops alert on 5xx (deduped/throttled; POSTs to ALERT_WEBHOOK_URL
  // when set, and always logs a structured alert line).
  // Share the one DI-managed alerter (MetricsModule) so its dedup / circuit
  // breaker span both the HTTP filter and domain callers (GST auth / dead-letter).
  app.useGlobalFilters(new ErrorFilter(app.get(ErrorAlertService)));
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
