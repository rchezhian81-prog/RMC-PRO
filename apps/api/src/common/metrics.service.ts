import { Injectable } from '@nestjs/common';

/**
 * A tiny, dependency-free Prometheus registry — just the metrics this API needs,
 * in the standard text exposition format a Prometheus/Grafana Agent scrapes.
 *
 * Hand-rolled to match the house style (the request logger, cookie parsing and
 * error alerter are all hand-rolled too) and to avoid pulling a client library
 * into the runtime. It records HTTP RED metrics (request rate, errors, duration)
 * plus a few process gauges.
 *
 * Cardinality is the one real risk with request metrics, so the route label is
 * the normalised path (ids collapsed to `:id`) and the number of distinct routes
 * is capped — anything past the cap folds into `route="other"` so a client
 * hammering random URLs can never blow up the series count.
 */

/** Duration buckets in seconds (cumulative `le`), covering ms to ~10s. */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Bound on distinct route labels; overflow folds into `other`. */
const MAX_ROUTES = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapse ids so `/orders/<uuid>` and `/orders/42` share one series. */
export function normalizeRoute(path: string): string {
  const base = (path || '').split('?')[0] || '/';
  const out = base
    .split('/')
    .map((seg) => (UUID.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
  return out || '/';
}

const escapeLabel = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

interface Hist {
  counts: number[]; // per-bucket (aligned to BUCKETS)
  sum: number;
  count: number;
}

interface CounterSeries {
  value: number;
  labels: Record<string, string>;
}
interface HistSeries {
  hist: Hist;
  labels: Record<string, string>;
}

/** Stable series key from a label set (order-independent). */
function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}
/** Prometheus label string (sorted, escaped), e.g. `a="1",b="2"`. */
function labelStr(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${escapeLabel(k)}="${escapeLabel(labels[k]!)}"`)
    .join(',');
}
function newHist(): Hist {
  return { counts: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
}

@Injectable()
export class MetricsService {
  /** method|route|status -> count */
  private readonly requests = new Map<string, number>();
  /** method|route -> histogram */
  private readonly durations = new Map<string, Hist>();
  private readonly routes = new Set<string>();
  private readonly startedAt = Date.now();

  /** Generic application counters: name -> { help, labelKey -> series }. */
  private readonly counters = new Map<string, { help: string; series: Map<string, CounterSeries> }>();
  /** Generic application histograms (seconds): name -> { help, labelKey -> series }. */
  private readonly histograms = new Map<string, { help: string; series: Map<string, HistSeries> }>();

  /** Increment a labelled application counter (e.g. gst_transmissions_total). Never throws. */
  incCounter(name: string, help: string, labels: Record<string, string> = {}, by = 1): void {
    try {
      let c = this.counters.get(name);
      if (!c) {
        c = { help, series: new Map() };
        this.counters.set(name, c);
      }
      const key = labelKey(labels);
      const s = c.series.get(key);
      if (s) s.value += by;
      else c.series.set(key, { value: by, labels });
    } catch {
      /* metrics must never affect the caller */
    }
  }

  /** Observe a duration (seconds) into a labelled application histogram. Never throws. */
  observeSeconds(name: string, help: string, seconds: number, labels: Record<string, string> = {}): void {
    try {
      let h = this.histograms.get(name);
      if (!h) {
        h = { help, series: new Map() };
        this.histograms.set(name, h);
      }
      const key = labelKey(labels);
      let s = h.series.get(key);
      if (!s) {
        s = { hist: newHist(), labels };
        h.series.set(key, s);
      }
      const d = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
      s.hist.sum += d;
      s.hist.count += 1;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (d <= BUCKETS[i]!) s.hist.counts[i]! += 1;
      }
    } catch {
      /* metrics must never affect the caller */
    }
  }

  /** True once we have hit the route cap — new routes fold into `other`. */
  private cappedRoute(route: string): string {
    if (this.routes.has(route)) return route;
    if (this.routes.size >= MAX_ROUTES) return 'other';
    this.routes.add(route);
    return route;
  }

  /** Record one finished HTTP request. `durationSec` is wall time in seconds. */
  observeHttp(method: string, rawPath: string, status: number, durationSec: number): void {
    try {
      const route = this.cappedRoute(normalizeRoute(rawPath));
      const m = (method || 'GET').toUpperCase();

      const ckey = `${m}|${route}|${status}`;
      this.requests.set(ckey, (this.requests.get(ckey) ?? 0) + 1);

      const hkey = `${m}|${route}`;
      let h = this.durations.get(hkey);
      if (!h) {
        h = { counts: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
        this.durations.set(hkey, h);
      }
      const d = Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0;
      h.sum += d;
      h.count += 1;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (d <= BUCKETS[i]!) h.counts[i]! += 1;
      }
    } catch {
      /* metrics must never affect a request */
    }
  }

  /** The full Prometheus exposition (text/plain; version=0.0.4). */
  render(): string {
    const lines: string[] = [];

    lines.push('# HELP http_requests_total Total HTTP requests by method, route and status.');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split('|');
      lines.push(
        `http_requests_total{method="${escapeLabel(method!)}",route="${escapeLabel(route!)}",status="${escapeLabel(status!)}"} ${value}`,
      );
    }

    lines.push('# HELP http_request_duration_seconds HTTP request latency in seconds.');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, h] of this.durations) {
      const [method, route] = key.split('|');
      const labels = `method="${escapeLabel(method!)}",route="${escapeLabel(route!)}"`;
      // counts[i] already holds "observations ≤ BUCKETS[i]" (the cumulative
      // bucket value), so emit it directly — do NOT re-accumulate.
      for (let i = 0; i < BUCKETS.length; i++) {
        lines.push(`http_request_duration_seconds_bucket{${labels},le="${BUCKETS[i]}"} ${h.counts[i]}`);
      }
      lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${h.sum}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${h.count}`);
    }

    const mem = process.memoryUsage();
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${mem.rss}`);
    lines.push('# HELP nodejs_heap_used_bytes Node.js heap used in bytes.');
    lines.push('# TYPE nodejs_heap_used_bytes gauge');
    lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`);

    lines.push('# HELP rmc_build_info Build/version info (always 1).');
    lines.push('# TYPE rmc_build_info gauge');
    lines.push(`rmc_build_info{service="rmc-api",version="${escapeLabel(process.env.APP_VERSION || '0.1.0')}"} 1`);

    // Generic application counters (e.g. gst_transmissions_total, gst_jobs_total).
    for (const [name, c] of this.counters) {
      lines.push(`# HELP ${name} ${c.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const s of c.series.values()) {
        const lbl = labelStr(s.labels);
        lines.push(`${name}${lbl ? `{${lbl}}` : ''} ${s.value}`);
      }
    }

    // Generic application histograms in seconds (e.g. gst_execution_seconds).
    for (const [name, h] of this.histograms) {
      lines.push(`# HELP ${name} ${h.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const s of h.series.values()) {
        const lbl = labelStr(s.labels);
        const sep = lbl ? ',' : '';
        for (let i = 0; i < BUCKETS.length; i++) {
          lines.push(`${name}_bucket{${lbl}${sep}le="${BUCKETS[i]}"} ${s.hist.counts[i]}`);
        }
        lines.push(`${name}_bucket{${lbl}${sep}le="+Inf"} ${s.hist.count}`);
        lines.push(`${name}_sum${lbl ? `{${lbl}}` : ''} ${s.hist.sum}`);
        lines.push(`${name}_count${lbl ? `{${lbl}}` : ''} ${s.hist.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}
