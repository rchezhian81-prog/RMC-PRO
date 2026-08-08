import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES } from '@rmc/shared';

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

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const { code, message, fields } = this.describe(exception, status);

    // Anything unexpected is logged in full here and summarised to the caller,
    // so a database or driver message never reaches a browser.
    if (status >= 500) {
      this.log.error(
        exception instanceof Error ? `${exception.message}` : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const error: { code: string; message: string | string[]; fields?: Record<string, string> } = {
      code,
      message,
    };
    if (fields) error.fields = fields;
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
