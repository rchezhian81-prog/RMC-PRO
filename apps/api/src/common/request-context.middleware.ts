import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { MetricsService } from './metrics.service';

/** Off switch for noisy environments; on by default. */
const ENABLED = process.env.REQUEST_LOG !== 'off';

/** The correlation-id header, lower-cased as Express normalises it. */
const HEADER = 'x-request-id';

/**
 * An inbound id is only trusted as far as it is safe to echo into a header and a
 * log line: a bounded, boring token. Anything else (missing, too long, or
 * carrying characters that could forge a second log record) is replaced with a
 * fresh uuid rather than rejected — a bad id must never fail a request.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

type ContextRequest = Request & { user?: AuthUser; requestId?: string };

/**
 * Gives every request a correlation id and one structured log line.
 *
 * Runs as middleware — BEFORE guards — so the id exists for the whole lifecycle,
 * is returned to the caller in the `X-Request-Id` response header, and is
 * present even when a guard rejects the request (401/403/429) before any
 * interceptor would run. nginx can forward its own `$request_id` and it is
 * honoured, so a line in the API log ties back to the same line in the access
 * log.
 *
 * The log line is emitted on `res.finish`, so there is exactly one per request
 * with the FINAL status — success, handler error, guard rejection, 404, or
 * throttle alike. It records only metadata (never bodies, so no secrets or PII
 * reach the log), tags each line with tenant_id/user for per-tenant visibility,
 * and reads the error code the `ErrorFilter` stashes on `res.locals`. Every
 * logging path is guarded so a logging failure can never affect the request.
 * Disable the log (not the id) with REQUEST_LOG=off.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: ContextRequest, res: Response, next: NextFunction): void {
    const inbound = req.headers[HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
    req.requestId = requestId;
    // Echo it back so a caller (or a user reporting an error) can quote it, and
    // set it early so it is present even on an error response.
    try {
      res.setHeader('X-Request-Id', requestId);
    } catch {
      /* headers already sent — nothing we can do, and not worth failing over */
    }

    const start = Date.now();
    res.on('finish', () => {
      try {
        const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
        // Health probes, the metrics scrape, and CORS preflight are pure noise —
        // skip them for BOTH the metrics and the log line (a scrape must never
        // inflate the metrics it is reading).
        if (path === '/health' || path.startsWith('/health/') || path === '/metrics' || req.method === 'OPTIONS') return;
        const status = res.statusCode ?? 200;
        const durationMs = Date.now() - start;

        // Metrics are recorded regardless of REQUEST_LOG (logging is the noisy
        // part; metrics are cheap and always wanted).
        this.metrics.observeHttp(req.method, path, status, durationMs / 1000);

        if (!ENABLED) return;
        const u = req.user;
        const errorCode = (res.locals?.errorCode as string | undefined) ?? undefined;
        const line = {
          t: new Date().toISOString(),
          level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          msg: 'request',
          method: req.method,
          path,
          status,
          durationMs,
          tenantId: u?.tenantId ?? null,
          userId: u?.userId ?? null,
          userType: u?.userType ?? null,
          requestId,
          ...(errorCode ? { errorCode } : {}),
        };
        console.log(JSON.stringify(line));
      } catch {
        /* metrics/logging must never break a request */
      }
    });

    next();
  }
}
