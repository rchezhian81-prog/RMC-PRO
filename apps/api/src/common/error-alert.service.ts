/**
 * Ops error alerting — turns server errors (5xx) into a signal someone can be
 * paged on, instead of a log line nobody watches.
 *
 * Deliberately a plain, standalone class (no Nest DI): it is constructed in
 * main.ts and handed to the ErrorFilter, and is trivially unit-testable. Two
 * delivery paths, both best-effort and fully guarded so alerting can never
 * affect a request:
 *   - a structured `{"level":"alert"}` log line (always) — so a log-based
 *     alert rule works even with nothing else wired up;
 *   - a POST to `ALERT_WEBHOOK_URL` (when set) — a generic JSON body that a
 *     Slack/Discord/incoming-webhook renders (`text`/`content`) and a custom
 *     relay can parse (structured fields).
 *
 * Noise control, so a broken deploy pages once rather than thousands of times:
 *   - only status >= ALERT_MIN_STATUS (default 500);
 *   - the same error signature is sent at most once per ALERT_DEDUP_WINDOW_MS
 *     (default 5 min), carrying how many were suppressed;
 *   - a circuit breaker caps total alerts to ALERT_MAX_PER_WINDOW per window.
 */
export interface ErrorAlertEvent {
  status: number;
  message?: string;
  /** Exception constructor name, e.g. QueryFailedError. */
  name?: string;
  requestId?: string;
  method?: string;
  path?: string;
  tenantId?: string | null;
  userId?: string | null;
}

export interface ErrorAlertConfig {
  webhookUrl?: string;
  minStatus: number;
  dedupWindowMs: number;
  maxPerWindow: number;
  timeoutMs: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

function configFromEnv(env: NodeJS.ProcessEnv): ErrorAlertConfig {
  return {
    webhookUrl: env.ALERT_WEBHOOK_URL?.trim() || undefined,
    minStatus: num(env.ALERT_MIN_STATUS, 500),
    dedupWindowMs: num(env.ALERT_DEDUP_WINDOW_MS, 5 * 60_000),
    maxPerWindow: num(env.ALERT_MAX_PER_WINDOW, 60),
    timeoutMs: num(env.ALERT_TIMEOUT_MS, 3_000),
  };
}

/** Collapse ids in a path so `/orders/<uuid>` and `/orders/<uuid2>` share a
 *  signature — otherwise every erroring id looks like a new incident. */
function normalizePath(path: string | undefined): string {
  if (!path) return '';
  const base = path.split('?')[0] ?? '';
  return base
    .split('/')
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^\d+$/.test(seg)
        ? ':id'
        : seg,
    )
    .join('/');
}

/** Never let an error message smuggle a credential into an alert channel. */
const SECRET = /(password|secret|token|authorization|bearer|api[_-]?key|hash)\s*[=:]\s*\S+/gi;
function scrub(message: string | undefined): string {
  const s = (message ?? 'Unhandled error').replace(SECRET, '$1=[redacted]');
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

export class ErrorAlertService {
  private readonly cfg: ErrorAlertConfig;
  /** signature -> { at: last-sent ms, suppressed: count since } */
  private readonly lastSent = new Map<string, { at: number; suppressed: number }>();
  /** timestamps of alerts actually sent, for the rolling circuit breaker. */
  private sentTimes: number[] = [];
  private stormLoggedAt = 0;

  constructor(config?: Partial<ErrorAlertConfig>, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.cfg = { ...configFromEnv(env), ...config };
  }

  private signature(e: ErrorAlertEvent): string {
    return `${e.status}:${e.name ?? ''}:${e.method ?? ''}:${normalizePath(e.path)}`;
  }

  /**
   * Consider one error for alerting. Returns the decision (handy for tests);
   * `now` is injectable for deterministic dedup tests. Never throws.
   */
  async capture(event: ErrorAlertEvent, now: number = Date.now()): Promise<'sent' | 'deduped' | 'stormed' | 'ignored'> {
    try {
      if (!event || event.status < this.cfg.minStatus) return 'ignored';

      const sig = this.signature(event);
      const prev = this.lastSent.get(sig);
      if (prev && now - prev.at < this.cfg.dedupWindowMs) {
        prev.suppressed += 1;
        return 'deduped';
      }

      // Circuit breaker: bound how many alerts leave per rolling window.
      this.sentTimes = this.sentTimes.filter((t) => now - t < this.cfg.dedupWindowMs);
      if (this.sentTimes.length >= this.cfg.maxPerWindow) {
        if (now - this.stormLoggedAt >= this.cfg.dedupWindowMs) {
          this.stormLoggedAt = now;
          this.emitLog({ level: 'alert', msg: 'error_alert_storm_suppressed', windowMs: this.cfg.dedupWindowMs, cap: this.cfg.maxPerWindow });
        }
        return 'stormed';
      }

      const suppressed = prev?.suppressed ?? 0;
      this.lastSent.set(sig, { at: now, suppressed: 0 });
      this.sentTimes.push(now);

      const payload = this.buildPayload(event, suppressed, now);
      this.emitLog(payload);
      await this.deliver(payload);
      return 'sent';
    } catch {
      // Alerting must never affect the request path.
      return 'ignored';
    }
  }

  private buildPayload(event: ErrorAlertEvent, suppressedSincePrev: number, now: number): Record<string, unknown> {
    const where = `${event.method ?? '?'} ${normalizePath(event.path) || '?'}`;
    const summary =
      `🔴 ${event.status} on ${where}` +
      (event.requestId ? ` [req ${event.requestId}]` : '') +
      (suppressedSincePrev > 0 ? ` (+${suppressedSincePrev} similar suppressed)` : '');
    return {
      level: 'alert',
      msg: 'error_alert',
      service: 'rmc-api',
      at: new Date(now).toISOString(),
      status: event.status,
      method: event.method ?? null,
      path: normalizePath(event.path) || null,
      requestId: event.requestId ?? null,
      tenantId: event.tenantId ?? null,
      userId: event.userId ?? null,
      error: scrub(event.message),
      suppressedSincePrev,
      // Fields incoming webhooks render as the message body:
      text: summary,
      content: summary,
    };
  }

  private emitLog(line: Record<string, unknown>): void {
    try {
      console.log(JSON.stringify({ t: new Date().toISOString(), ...line }));
    } catch {
      /* logging must never break the caller */
    }
  }

  private async deliver(payload: Record<string, unknown>): Promise<void> {
    if (!this.cfg.webhookUrl) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.emitLog({ level: 'warn', msg: 'error_alert_delivery_failed', status: res.status });
      }
    } catch (err) {
      this.emitLog({
        level: 'warn',
        msg: 'error_alert_delivery_error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
