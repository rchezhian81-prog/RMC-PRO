import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GstJobService } from './gst-execution-job.service';

/** Parse an int env var with a default + bounds. */
function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Background drainer for the durable GST execution queue (GW-1). OPT-IN via
 * `GST_WORKER_ENABLED=true` — off by default, so a deployment (or the test
 * harness) that drives execution synchronously via `POST …/execute` behaves
 * exactly as before. When enabled it polls {@link GstJobService.drainOnce} every
 * `GST_WORKER_INTERVAL_MS` (default 5s), processing due jobs across all tenants.
 *
 * A single in-process flag prevents overlapping ticks; the atomic job claim in
 * the service prevents double-running even across multiple worker instances, so
 * this is safe to run on more than one node.
 */
@Injectable()
export class GstExecutionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(GstExecutionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly jobs: GstJobService) {}

  onModuleInit(): void {
    if ((process.env.GST_WORKER_ENABLED ?? '').toLowerCase() !== 'true') {
      this.log.log('GST execution worker: disabled (set GST_WORKER_ENABLED=true to drain the queue in-process).');
      return;
    }
    const intervalMs = clampInt(process.env.GST_WORKER_INTERVAL_MS, 5000, 1000, 300_000);
    this.log.log(`GST execution worker: enabled (draining every ${intervalMs}ms).`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Don't keep the process alive solely for the poll loop.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      const { processed } = await this.jobs.drainOnce();
      if (processed > 0) this.log.log(`GST execution worker: processed ${processed} job(s).`);
    } catch (e) {
      this.log.warn(`GST execution worker tick failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.ticking = false;
    }
  }
}
