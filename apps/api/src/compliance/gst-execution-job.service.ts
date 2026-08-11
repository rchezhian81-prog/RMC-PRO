import { Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { MetricsService } from '../common/metrics.service';
import { ErrorAlertService } from '../common/error-alert.service';
import { GstExecutionJob } from '../core/database/entities';
import { GstExecutionService, type GstExecutionOutcome } from './gst-execution.service';

const JOBS_METRIC_HELP = 'GST execution queue job lifecycle events (enqueued/done/retried/deadlettered/skipped).';

/** Outcome statuses that mean the action is DONE — the job is complete. */
const JOB_TERMINAL_DONE = new Set([
  'generated',
  'cancelled',
  'updated',
  'extended',
  'reconciled',
  'already_generated',
  'already_cancelled',
]);

/**
 * Map an {@link GstExecutionOutcome} status to the job's next lifecycle state:
 *   - `done`   — the action completed (incl. idempotent already_* and reconciled);
 *   - `failed` — a real failure (pre-flight / transport); the caller decides retry;
 *   - `queued` — nothing happened (`skipped`, provider off) → leave it to run later.
 */
export function jobStatusForOutcome(status: string): 'done' | 'failed' | 'queued' {
  if (JOB_TERMINAL_DONE.has(status)) return 'done';
  if (status === 'failed') return 'failed';
  return 'queued';
}

/** Exponential backoff (ms) before a failed job's next attempt: base·2^attempts, capped. */
export function backoffMs(attempts: number, baseMs = 30_000, capMs = 3_600_000): number {
  const n = Math.max(0, Math.floor(attempts));
  return Math.min(capMs, baseMs * 2 ** n);
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit) || 1, 1), 100);
}

function outcomeError(outcome: GstExecutionOutcome): string | null {
  if (outcome.status === 'failed') return (outcome.errors ?? []).join('; ').slice(0, 500) || 'failed';
  return null;
}

interface EnqueueInput {
  tenantId: string;
  approvalId: string;
  invoiceId: string;
  actionKind: string;
  requestedBy: string | null;
}

interface ClaimedJob {
  approvalId: string;
  attempts: number;
  maxAttempts: number;
  requestedBy: string | null;
}

/**
 * The durable GST execution queue (GW-1). Approving a GST action ENQUEUES a job
 * here instead of the request thread calling the slow, rate-limited portal inline.
 * Jobs are drained — by the background worker (cross-tenant, {@link drainOnce}) or
 * an operator ({@link drainForTenant}) — each claim being atomic (queued→running)
 * so concurrent drainers never double-run one job. Processing delegates to the
 * idempotent {@link GstExecutionService.execute}; transient failures back off and
 * retry up to `max_attempts`, then dead-letter. The manual `execute` endpoint
 * still runs synchronously and calls {@link reconcileManual} to keep the job row
 * coherent, so the two paths never fight.
 */
@Injectable()
export class GstJobService {
  private readonly log = new Logger(GstJobService.name);

  constructor(
    private readonly execution: GstExecutionService,
    private readonly db: TenantDbService,
    private readonly metrics: MetricsService,
    private readonly alerter: ErrorAlertService,
  ) {}

  private countJob(event: string): void {
    this.metrics.incCounter('gst_jobs_total', JOBS_METRIC_HELP, { event });
  }

  /** Enqueue a job for an approved GST action. Idempotent — one job per approval. */
  async enqueue(input: EnqueueInput): Promise<{ enqueued: boolean; jobId: string | null }> {
    const rows = await this.db.runInTenant(input.tenantId, (m) =>
      m.query(
        `INSERT INTO gst_execution_jobs (tenant_id, approval_id, invoice_id, action_kind, requested_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (approval_id) DO NOTHING
         RETURNING id`,
        [input.tenantId, input.approvalId, input.invoiceId, input.actionKind, input.requestedBy],
      ),
    );
    const jobId: string | null = rows?.[0]?.id ?? null;
    if (jobId) this.countJob('enqueued');
    return { enqueued: !!jobId, jobId };
  }

  /** This tenant's jobs, newest first (ops visibility). */
  listForTenant(tenantId: string, limit = 100): Promise<GstExecutionJob[]> {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(GstExecutionJob).find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: clampLimit(limit) * 5 }),
    );
  }

  /**
   * Reconcile a job after the SYNCHRONOUS `execute` endpoint ran it directly:
   * mark it `done`/`failed` so a later drain does not re-run an already-executed
   * action. Best-effort — never throws into the request path. A `skipped` outcome
   * (provider off) leaves the job queued to run once a provider is configured.
   */
  async reconcileManual(tenantId: string, approvalId: string, outcome: GstExecutionOutcome): Promise<void> {
    const target = jobStatusForOutcome(outcome.status);
    if (target === 'queued') return;
    try {
      await this.db.runInTenant(tenantId, (m) =>
        m.query(
          `UPDATE gst_execution_jobs
              SET status=$3, last_outcome=$4, last_error=$5,
                  attempts = attempts + CASE WHEN $3 = 'failed' THEN 1 ELSE 0 END,
                  updated_at = now()
            WHERE approval_id=$2 AND tenant_id=$1 AND status IN ('queued','running','failed')`,
          [tenantId, approvalId, target, outcome.status, outcomeError(outcome)],
        ),
      );
    } catch (e) {
      this.log.warn(`job reconcile failed for approval ${approvalId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Drain THIS tenant's due jobs now (operator trigger / worker fallback). */
  async drainForTenant(tenantId: string, limit = 20, actorUserId: string | null = null): Promise<{ processed: number; outcomes: string[] }> {
    const due: Array<{ id: string }> = await this.db.runInTenant(tenantId, (m) =>
      m.query(
        `SELECT id FROM gst_execution_jobs
          WHERE tenant_id=$1 AND status='queued' AND next_run_at <= now()
          ORDER BY next_run_at ASC LIMIT $2`,
        [tenantId, clampLimit(limit)],
      ),
    );
    const outcomes: string[] = [];
    for (const row of due) {
      const r = await this.claimAndRun(tenantId, row.id, actorUserId);
      if (r.claimed && r.outcome) outcomes.push(r.outcome.status);
    }
    return { processed: outcomes.length, outcomes };
  }

  /** Cross-tenant drain for the background worker (runs as platform to find due jobs). */
  async drainOnce(limit = 20): Promise<{ processed: number }> {
    const due: Array<{ id: string; tenantId: string }> = await this.db.runAsPlatform((m) =>
      m.query(
        `SELECT id, tenant_id AS "tenantId" FROM gst_execution_jobs
          WHERE status='queued' AND next_run_at <= now()
          ORDER BY next_run_at ASC LIMIT $1`,
        [clampLimit(limit)],
      ),
    );
    let processed = 0;
    for (const row of due) {
      const r = await this.claimAndRun(row.tenantId, row.id, null);
      if (r.claimed) processed++;
    }
    return { processed };
  }

  /**
   * Atomically claim ONE queued job (queued→running) and run it. The claim is a
   * conditional UPDATE, so if another drainer took it first this returns
   * `{ claimed: false }` and does nothing — the guarantee against double-running.
   */
  async claimAndRun(tenantId: string, jobId: string, actorUserId: string | null = null): Promise<{ claimed: boolean; outcome?: GstExecutionOutcome }> {
    const claimed = await this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.query(
        `UPDATE gst_execution_jobs SET status='running', updated_at=now()
          WHERE id=$1 AND tenant_id=$2 AND status='queued'
        RETURNING approval_id AS "approvalId", attempts, max_attempts AS "maxAttempts", requested_by AS "requestedBy"`,
        [jobId, tenantId],
      );
      return (rows?.[0] as ClaimedJob | undefined) ?? null;
    });
    if (!claimed) return { claimed: false };

    let outcome: GstExecutionOutcome;
    try {
      outcome = await this.execution.execute(tenantId, claimed.approvalId, actorUserId ?? claimed.requestedBy ?? null);
    } catch (e) {
      // A thrown error (not a normal failed outcome) is treated as a retryable failure.
      outcome = { status: 'failed', errors: [e instanceof Error ? e.message : String(e)] };
    }
    await this.finalize(tenantId, jobId, claimed, outcome);
    return { claimed: true, outcome };
  }

  /** Write the job's terminal/retry state from the execution outcome. */
  private async finalize(tenantId: string, jobId: string, claimed: ClaimedJob, outcome: GstExecutionOutcome): Promise<void> {
    const target = jobStatusForOutcome(outcome.status);
    if (target === 'done') {
      await this.db.runInTenant(tenantId, (m) =>
        m.query(
          `UPDATE gst_execution_jobs SET status='done', last_outcome=$2, last_error=NULL, updated_at=now() WHERE id=$1`,
          [jobId, outcome.status],
        ),
      );
      this.countJob('done');
      return;
    }
    if (target === 'failed') {
      const attempts = Number(claimed.attempts) + 1;
      const dead = attempts >= Number(claimed.maxAttempts);
      const nextRunAt = dead ? new Date() : new Date(Date.now() + backoffMs(attempts));
      await this.db.runInTenant(tenantId, (m) =>
        m.query(
          `UPDATE gst_execution_jobs
              SET status=$2, attempts=$3, last_outcome=$4, last_error=$5, next_run_at=$6, updated_at=now()
            WHERE id=$1`,
          [jobId, dead ? 'dead' : 'queued', attempts, outcome.status, outcomeError(outcome), nextRunAt],
        ),
      );
      this.countJob(dead ? 'deadlettered' : 'retried');
      if (dead) {
        // A dead-lettered job needs a human — it exhausted its retries.
        void this.alerter.captureOps({
          key: 'gst_job_deadlettered',
          message: `GST execution job dead-lettered after ${attempts} attempts (job ${jobId}, approval ${claimed.approvalId})`,
          tenantId,
          detail: { jobId, approvalId: claimed.approvalId, lastError: outcomeError(outcome) },
        });
      }
      return;
    }
    // 'queued' (skipped / provider off) — release the claim back to queued.
    await this.db.runInTenant(tenantId, (m) =>
      m.query(`UPDATE gst_execution_jobs SET status='queued', last_outcome=$2, updated_at=now() WHERE id=$1`, [jobId, outcome.status]),
    );
    this.countJob('skipped');
  }
}
