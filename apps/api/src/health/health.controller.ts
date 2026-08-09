import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Liveness — "the process is up and answering". No dependencies, so a load
   * balancer never restarts the API just because the database is briefly away.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'rmc-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness — "the API can actually serve requests". Pings the database, since
   * every real request needs it. Returns 503 when the DB is unreachable so an
   * orchestrator (or nginx) stops routing traffic to this instance until it
   * recovers, rather than serving a wall of 500s. Kept separate from liveness so
   * a DB blip pauses traffic without killing the process.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    try {
      await this.db.ds.query('SELECT 1');
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Database is not reachable',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { status: 'ready', db: 'up', timestamp: new Date().toISOString() };
  }
}
