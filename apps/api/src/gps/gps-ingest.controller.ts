import { Body, Controller, Headers, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GpsIngestService } from './gps-ingest.service';

/**
 * The vendor-facing feed. No login: the tenant's ingest key (X-RMC-GPS-KEY
 * header, or ?key= for gateways that cannot set headers) is the credential.
 * Rate-limited per caller so a runaway device cannot flood the API.
 */
@Controller('gps/ingest')
export class GpsIngestController {
  constructor(private readonly service: GpsIngestService) {}

  @Post()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  ingest(@Headers('x-rmc-gps-key') headerKey: string | undefined, @Query('key') queryKey: string | undefined, @Body() body: unknown) {
    return this.service.ingest(headerKey ?? queryKey ?? '', body);
  }
}
