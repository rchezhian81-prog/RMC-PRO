import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { ApiSuccess } from '@rmc/shared';

/**
 * Wraps every successful response in the standard envelope (Design Doc 7 §2.4).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(map((data): ApiSuccess<T> => ({ success: true, data })));
  }
}
