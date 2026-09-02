import { Controller, Get, Req, Res } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Constant-time bearer comparison so a wrong guess can't be refined from the
 * response timing. `timingSafeEqual` needs equal-length buffers, so an unequal
 * length short-circuits to false (the length itself is not the secret).
 */
function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /metrics` — Prometheus scrape endpoint (unprefixed, like `/health`).
 *
 * Written with `@Res` so the raw exposition is returned as-is, not wrapped in
 * the `{ success, data }` envelope a Prometheus parser would reject.
 *
 * The endpoint leaks operational shape (request rates, error rates, memory), so
 * on an internet-facing API it should be protected: set `METRICS_TOKEN` and the
 * endpoint requires `Authorization: Bearer <token>` (Prometheus supports this
 * natively). When unset it is open — rely on a network/nginx restriction (scrape
 * from localhost only). See the observability runbook.
 */
const TOKEN = process.env.METRICS_TOKEN?.trim() || undefined;

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  scrape(@Req() req: Request, @Res() res: Response): void {
    if (TOKEN) {
      const header = req.headers.authorization;
      const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
      if (!tokenMatches(bearer, TOKEN)) {
        res.status(401).type('text/plain').send('unauthorized\n');
        return;
      }
    }
    res.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(this.metrics.render());
  }
}
