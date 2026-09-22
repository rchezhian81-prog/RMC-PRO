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
    // One webhook for the whole box: ALERT_WEBHOOK_URL when set, else
    // RMC_ALERT_WEBHOOK — the name the on-box scripts (health monitor, backups)
    // read — so a single line in .env.production wires everything.
    webhookUrl: env.ALERT_WEBHOOK_URL?.trim() || env.RMC_ALERT_WEBHOOK?.trim() || undefined,
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

  /** Whether a webhook is configured — never the URL itself, which carries a secret. */
  webhookConfigured(): boolean {
    return Boolean(this.cfg.webhookUrl);
  }

  /**
   * Send one test message through the real delivery path, so an operator can
   * see the channel works before an incident does. Not deduped (every test is
   * its own event) and never throws; says exactly what happened.
   */
  async sendTest(origin = 'api'): Promise<{ configured: boolean; delivered: boolean; status?: number; error?: string; message: string }> {
    const now = Date.now();
    const message = `🔔 Test alert from Mix Nova RMC (${origin}) — alerts are wired. ${new Date(now).toISOString()}`;
    if (!this.cfg.webhookUrl) {
      return { configured: false, delivered: false, message, error: 'No alert webhook is configured on the server — set RMC_ALERT_WEBHOOK in .env.production and restart the api.' };
    }
    const payload = { level: 'info', msg: 'alert_test', service: 'rmc-api', at: new Date(now).toISOString(), origin, text: message, content: message };
    this.emitLog(payload);
    const r = await this.deliverResult(payload);
    return { configured: true, delivered: r.ok, status: r.status, error: r.error, message };
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

  /**
   * Raise an OPERATIONAL alert that is not an HTTP 5xx — e.g. a GST portal auth
   * failure or a dead-lettered execution job. Shares the same dedup window,
   * circuit breaker and webhook delivery as {@link capture}, keyed by `key` so a
   * recurring condition pages once per window. Never throws.
   */
  async captureOps(
    event: { key: string; message: string; tenantId?: string | null; detail?: Record<string, unknown> },
    now: number = Date.now(),
  ): Promise<'sent' | 'deduped' | 'stormed' | 'ignored'> {
    try {
      if (!event?.key) return 'ignored';
      const sig = `ops:${event.key}`;
      const prev = this.lastSent.get(sig);
      if (prev && now - prev.at < this.cfg.dedupWindowMs) {
        prev.suppressed += 1;
        return 'deduped';
      }
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

      const summary =
        `⚠️ ${event.key}: ${scrub(event.message)}` + (suppressed > 0 ? ` (+${suppressed} similar suppressed)` : '');
      const payload = {
        level: 'alert',
        msg: 'ops_alert',
        service: 'rmc-api',
        at: new Date(now).toISOString(),
        key: event.key,
        tenantId: event.tenantId ?? null,
        error: scrub(event.message),
        detail: event.detail ?? null,
        suppressedSincePrev: suppressed,
        text: summary,
        content: summary,
      };
      this.emitLog(payload);
      await this.deliver(payload);
      return 'sent';
    } catch {
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
    const r = await this.deliverResult(payload);
    if (!r.ok) {
      if (r.status !== undefined) this.emitLog({ level: 'warn', msg: 'error_alert_delivery_failed', status: r.status });
      else this.emitLog({ level: 'warn', msg: 'error_alert_delivery_error', error: r.error });
    }
  }

  /** POST the payload; report the outcome instead of throwing (alerting is best-effort). */
  private async deliverResult(payload: Record<string, unknown>): Promise<{ ok: boolean; status?: number; error?: string }> {
    if (!this.cfg.webhookUrl) return { ok: false, error: 'no webhook configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        // Never follow a redirect: Slack answers an incomplete webhook URL with
        // a 302 to a help page, and following it turned "wrong URL" into a 200
        // that read as delivered while nothing reached the channel.
        redirect: 'manual',
      });
      if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400)) {
        return { ok: false, status: res.status || 302, error: `the webhook redirected (HTTP ${res.status || 302}) — the URL is incomplete or wrong` };
      }
      return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `the webhook answered HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: /abort/i.test(msg) ? `no answer from the webhook within ${this.cfg.timeoutMs} ms` : msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
