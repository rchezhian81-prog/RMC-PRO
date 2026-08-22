import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@rmc/shared';
import type { AuthUser } from '../auth/auth-user';
import type { ErrorAlertService } from './error-alert.service';

/**
 * Puts every failure into the documented envelope (Design Doc 7 §2.4):
 *
 *   { "success": false, "error": { "code": "...", "message": "..." } }
 *
 * Successes already go through `ResponseInterceptor`; without this, failures
 * came back in Nest's own shape (`{ statusCode, message, error }`). The web
 * client reads `error.code` to decide what to tell the person at the screen —
 * whether this is a role problem they should take to their administrator, or a
 * subscription problem only Mix Nova can fix — and in Nest's shape `error` is
 * the string "Forbidden", so that decision could never be made and every
 * refusal read the same.
 *
 * A code thrown deliberately (`throw new ForbiddenException({ code, message })`)
 * is passed through untouched. Anything else is given the code its status
 * implies, so older throws that predate the convention still answer sensibly.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Api');

  /** Optional ops alerter (wired in main.ts). Absent in unit tests. */
  constructor(private readonly alerter?: ErrorAlertService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { requestId?: string; user?: AuthUser }>();
    const requestId = req?.requestId;
    // A Postgres unique-violation arrives as a raw driver error; treat it as a
    // 409 (duplicate) rather than letting it fall through to a generic 500.
    const dup = uniqueViolation(exception);
    const status = dup
      ? HttpStatus.CONFLICT
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const { code, message, fields } = dup ?? this.describe(exception, status);

    // Hand the code to the request logger (RequestContextMiddleware reads it off
    // res.locals when the response finishes), so the one log line for this
    // request carries the same code the caller sees.
    if (res.locals) res.locals.errorCode = code;

    // Anything unexpected is logged in full here and summarised to the caller,
    // so a database or driver message never reaches a browser. The request id
    // ties this stack back to the request log line and the caller's response.
    if (status >= 500) {
      this.log.error(
        `[${requestId ?? 'no-request-id'}] ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Fire an ops alert (deduped + throttled inside the alerter). Best-effort:
      // the alerter never throws, and the void keeps the response synchronous.
      void this.alerter?.capture({
        status,
        message: exception instanceof Error ? exception.message : String(exception),
        name: exception instanceof Error ? exception.constructor?.name : undefined,
        requestId,
        method: req?.method,
        path: req?.originalUrl ?? req?.url,
        tenantId: req?.user?.tenantId ?? null,
        userId: req?.user?.userId ?? null,
      });
    }

    const error: {
      code: string;
      message: string | string[];
      fields?: Record<string, string>;
      requestId?: string;
    } = { code, message };
    if (fields) error.fields = fields;
    // Surfaced so a person reporting an error can quote it and support can find
    // the exact request in the logs.
    if (requestId) error.requestId = requestId;
    res.status(status).json({ success: false, error });
  }

  private describe(
    exception: unknown,
    status: number,
  ): { code: string; message: string | string[]; fields?: Record<string, string> } {
    const fallbackCode = codeForStatus(status);
    if (status >= 500) {
      return { code: fallbackCode, message: 'Something went wrong. Please try again.' };
    }
    if (!(exception instanceof HttpException)) {
      return { code: fallbackCode, message: 'Request failed' };
    }

    const body = exception.getResponse();
    if (typeof body === 'string') return { code: fallbackCode, message: body };

    const obj = body as { code?: unknown; message?: unknown; error?: unknown; fields?: unknown };
    const message =
      Array.isArray(obj.message) || typeof obj.message === 'string'
        ? (obj.message as string | string[])
        : typeof obj.error === 'string'
          ? obj.error
          : exception.message;
    // Field-level validation detail is passed through so the form can highlight
    // the offending inputs, not just show a single banner.
    const fields =
      obj.fields && typeof obj.fields === 'object' ? (obj.fields as Record<string, string>) : undefined;
    return { code: typeof obj.code === 'string' ? obj.code : fallbackCode, message, fields };
  }
}

/**
 * A Postgres unique-violation (SQLSTATE 23505) reaches the filter as a raw
 * TypeORM `QueryFailedError`, so without this it becomes a generic 500 ("try
 * again") — misleading for the most common master mistake, entering a code that
 * already exists. Map it to a 409 the web client shows verbatim. The pg code is
 * on the wrapped driver error (`.driverError.code`) or the error itself.
 */
function uniqueViolation(exception: unknown): { code: string; message: string; fields?: Record<string, string> } | null {
  const e = exception as { code?: unknown; driverError?: { code?: unknown } };
  const pgCode = e?.driverError?.code ?? e?.code;
  if (pgCode !== '23505') return null;
  return { code: ERROR_CODES.DUPLICATE_RECORD, message: 'A record with the same code already exists.' };
}

/** The code that best describes a refusal that did not name one itself. */
function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.AUTH_REQUIRED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.PERMISSION_DENIED;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.RECORD_NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.DUPLICATE_RECORD;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_ERROR;
  }
}
