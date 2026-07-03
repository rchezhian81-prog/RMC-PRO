import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Versioned API base path (Design Doc 7 §2.2); health stays unprefixed.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors();

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
  await app.listen(port);
  console.log(`[api] RMC API listening on http://localhost:${port} (health: /health)`);
}

void bootstrap();
