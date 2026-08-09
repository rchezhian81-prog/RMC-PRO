import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth-user';

/** Off switch for noisy environments; on by default. */
const ENABLED = process.env.REQUEST_LOG !== 'off';

type LoggedRequest = Request & { user?: AuthUser; requestId?: string };

/**
 * Emits one structured JSON line per request — method, path, status, latency,
 * and the tenant/user it ran as — so `docker logs` is greppable today and the
 * output is ready to ship to any log aggregator (Loki, ELK, a SaaS) without a
 * code change. Tagging each line with tenant_id is what makes per-tenant latency
 * and noisy-neighbour problems visible in a multi-tenant SaaS.
 *
 * It only ever reads metadata (never request/response bodies, so no secrets or
 * PII leak into logs), and every logging path is wrapped so a logging failure
 * can never affect the actual request. Disable with REQUEST_LOG=off.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!ENABLED || context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<LoggedRequest>();
    const res = http.getResponse<Response>();

    // Skip the unauthenticated liveness probe and CORS preflight — pure noise.
    if (req.path === '/health' || req.method === 'OPTIONS') return next.handle();

    const start = Date.now();
    const requestId = req.requestId ?? randomUUID();
    req.requestId = requestId;

    const emit = (status: number, errorCode?: string): void => {
      try {
        const u = req.user;
        const line = {
          t: new Date().toISOString(),
          level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          msg: 'request',
          method: req.method,
          path: (req.originalUrl ?? req.url ?? '').split('?')[0],
          status,
          durationMs: Date.now() - start,
          tenantId: u?.tenantId ?? null,
          userId: u?.userId ?? null,
          userType: u?.userType ?? null,
          requestId,
          ...(errorCode ? { errorCode } : {}),
        };
        console.log(JSON.stringify(line));
      } catch {
        /* logging must never break a request */
      }
    };

    return next.handle().pipe(
      tap({
        next: () => emit(res.statusCode ?? 200),
        error: (err: unknown) => {
          let status = 500;
          let code: string | undefined;
          if (err instanceof HttpException) {
            status = err.getStatus();
            const body = err.getResponse();
            if (body && typeof body === 'object' && 'code' in body) {
              const c = (body as { code?: unknown }).code;
              if (typeof c === 'string') code = c;
            }
          }
          emit(status, code);
        },
      }),
    );
  }
}
