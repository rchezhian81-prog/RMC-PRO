import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AlertsService } from './alerts.service';
import { ErrorAlertService } from '../common/error-alert.service';
import { buildAlertDigest, shouldSendDigest, type DigestSeverity } from './alert-digest.util';

/** Parse an int env var with a default + bounds. */
function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Scheduled alert digest (Tier-5G). OPT-IN via `ALERT_DIGEST_ENABLED=true` — off
 * by default, so a deployment without it behaves exactly as before. When enabled
 * it polls every `ALERT_DIGEST_INTERVAL_MS` (default 15 min); on the tick whose
 * UTC hour matches `ALERT_DIGEST_HOUR` (default 8; note 08:00 IST ≈ 02 UTC) it
 * runs the same rule-based alerts as GET /alerts for every active tenant, keeps
 * those at/above `ALERT_DIGEST_MIN_SEVERITY` (default 'danger'), and pushes a
 * once-a-day digest to the ops channel via ErrorAlertService.captureOps (which
 * logs a structured line always and POSTs to ALERT_WEBHOOK_URL when configured).
 *
 * A per-tenant in-memory "sent today" guard makes it once-a-day within a run; the
 * push key is per-tenant so captureOps' dedup window doesn't cross tenants. The
 * guard is in-memory, so a restart during the send hour could re-send a tenant's
 * digest once — an acceptable, low-harm duplicate that captureOps' own dedup
 * window further softens. A single in-process flag prevents overlapping ticks.
 */
@Injectable()
export class AlertDigestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AlertDigestWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** tenantId -> YYYY-MM-DD it was last processed (sent or found empty). */
  private readonly lastProcessed = new Map<string, string>();

  private sendHourUtc = 8;
  private minSeverity: DigestSeverity = 'danger';

  constructor(
    private readonly db: TenantDbService,
    private readonly alerts: AlertsService,
    private readonly errorAlerts: ErrorAlertService,
  ) {}

  onModuleInit(): void {
    if ((process.env.ALERT_DIGEST_ENABLED ?? '').toLowerCase() !== 'true') {
      this.log.log('Alert digest: disabled (set ALERT_DIGEST_ENABLED=true to push a daily digest).');
      return;
    }
    this.sendHourUtc = clampInt(process.env.ALERT_DIGEST_HOUR, 8, 0, 23);
    this.minSeverity = (process.env.ALERT_DIGEST_MIN_SEVERITY ?? '').toLowerCase() === 'warning' ? 'warning' : 'danger';
    const intervalMs = clampInt(process.env.ALERT_DIGEST_INTERVAL_MS, 900_000, 60_000, 3_600_000);
    this.log.log(
      `Alert digest: enabled (>= ${this.minSeverity} at ${this.sendHourUtc}:00 UTC, polling every ${intervalMs}ms).`,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      // Cheap gate: only the configured hour does any work, so the tenant scan
      // and the alert queries run at most a handful of times a day.
      if (now.getUTCHours() !== this.sendHourUtc) return;

      const tenants = await this.db.runAsPlatform<Array<{ id: string }>>((m) =>
        m.query(`SELECT id FROM tenants WHERE status = 'active'`),
      );

      let sent = 0;
      for (const t of tenants) {
        const tenantId = String(t.id);
        if (!shouldSendDigest(now, this.sendHourUtc, this.lastProcessed.get(tenantId) ?? null)) continue;
        // Mark processed up front (sent or empty) so we don't re-scan this tenant
        // on the next tick within the same hour.
        this.lastProcessed.set(tenantId, now.toISOString().slice(0, 10));
        try {
          const { alerts } = await this.alerts.list(tenantId);
          const digest = buildAlertDigest(alerts, this.minSeverity);
          if (!digest) continue;
          await this.errorAlerts.captureOps({
            key: `alert_digest:${tenantId}`,
            message: digest.text,
            tenantId,
            detail: { bySeverity: digest.bySeverity, alerts: digest.lines },
          });
          sent += 1;
        } catch (e) {
          this.log.warn(`Alert digest for tenant ${tenantId} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (sent > 0) this.log.log(`Alert digest: pushed ${sent} digest(s).`);
    } catch (e) {
      this.log.warn(`Alert digest tick failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.ticking = false;
    }
  }
}
