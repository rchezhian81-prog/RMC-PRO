'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getAccess } from '../../../lib/session';
import {
  ClipboardList, Lock, Ticket, Truck, PackageCheck, ReceiptText, Clock, Wallet, TrendingDown,
  AlertTriangle, MonitorSmartphone, ArrowUpRight, CalendarRange, Layers, Droplets,
} from 'lucide-react';
import {
  dashboardApi, billingReportsApi, ordersApi, type Row, type TrendsResult, type TrendSeries, type DashboardPeriod,
} from '../../../lib/api';
import { formatDate } from '../../../lib/format-date';
import { currentMonthRange, todayLocal } from '../../../lib/report-range';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { AlertsCard } from '../../../components/AlertsCard';
import { InsightsCard } from '../../../components/InsightsCard';
import { SeverityLegend } from '../../../components/SeverityLegend';
import { Loading, ErrorState } from '../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');
const m3 = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const pos = (v: unknown) => Number(v ?? 0) > 0;

/** Compact Indian-currency form for space-tight chart labels (donut, gauge). */
const compact = (v: unknown) => {
  const x = Number(v ?? 0);
  if (x >= 1e7) return '₹' + (x / 1e7).toFixed(2) + 'Cr';
  if (x >= 1e5) return '₹' + (x / 1e5).toFixed(2) + 'L';
  if (x >= 1e3) return '₹' + (x / 1e3).toFixed(1) + 'k';
  return '₹' + x.toLocaleString('en-IN');
};

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

// ---- Period ----------------------------------------------------------------
type PeriodKey = 'today' | 'week' | 'month' | 'custom';
interface PeriodChoice extends DashboardPeriod {
  key: PeriodKey;
}
/** Remembered per browser so the dashboard opens on the window last chosen. */
const PERIOD_STORAGE_KEY = 'mn.dashboard.period';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** The quick windows, each a pure function of "now" (local calendar, see report-range.ts). */
const PRESETS: Array<{ key: Exclude<PeriodKey, 'custom'>; label: string; range: (now: Date) => DashboardPeriod }> = [
  { key: 'today', label: 'Today', range: (now) => ({ from: todayLocal(now), to: todayLocal(now) }) },
  {
    key: 'week',
    label: 'This week',
    range: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      return { from: ymd(d), to: todayLocal(now) };
    },
  },
  { key: 'month', label: 'This month', range: (now) => currentMonthRange(now) },
];
const DEFAULT_PERIOD = (): PeriodChoice => ({ key: 'month', ...currentMonthRange() });
/** A preset is re-derived from today's date; a custom window is kept as saved. */
function readStoredPeriod(): PeriodChoice {
  try {
    const raw = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return DEFAULT_PERIOD();
    const v = JSON.parse(raw) as Partial<PeriodChoice>;
    const preset = PRESETS.find((p) => p.key === v.key);
    if (preset) return { key: preset.key, ...preset.range(new Date()) };
    if (v.key === 'custom' && YMD.test(String(v.from)) && YMD.test(String(v.to)) && String(v.from) <= String(v.to)) {
      return { key: 'custom', from: String(v.from), to: String(v.to) };
    }
  } catch {
    /* storage blocked or garbage — the default month */
  }
  return DEFAULT_PERIOD();
}
/** "1 Oct 2026 → 11 Oct 2026", or just the day when the window is one day. */
const periodLabel = (p: DashboardPeriod) => (p.from === p.to ? formatDate(p.from) : `${formatDate(p.from)} → ${formatDate(p.to)}`);

/**
 * The owner's home screen — one layout for both skins (the UI V2 flag only
 * changes the tokens the cards and tiles read). Everything here is
 * PRESENTATION over data the dashboard already exposed: the summary and funnel
 * endpoints, the outstanding-aging report, the daily trend-lines and the
 * newest orders. Every figure is a link to the screen behind it.
 *
 *   hero band   → the four figures an owner opens the app for, on the brand
 *                 gradient with the landing page's aurora + dot-grid texture
 *   attention   → the rule-based alerts (and AI insights when configured)
 *   charts      → order-to-cash funnel · outstanding by age · collections
 *   activity    → 7/30/90-day sparklines beside the latest orders
 *   operations  → the remaining counters as compact tiles
 */
export default function DashboardPage() {
  const router = useRouter();
  // A driver's login holds My Trips and nothing else: the dashboard's reports
  // would only refuse them, so they land on their trips instead.
  useEffect(() => {
    const a = getAccess();
    if (!a.isOwner && a.has('driver.trips') && !a.has('reports.view') && !a.has('orders.view')) router.replace('/app/driver');
  }, [router]);
  const [s, setS] = useState<Row | null>(null);
  const [funnel, setFunnel] = useState<Row | null>(null);
  const [aging, setAging] = useState<Row | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [trends, setTrends] = useState<TrendsResult | null>(null);
  const [trendsDays, setTrendsDays] = useState(30);
  const [trendsBusy, setTrendsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The window the event figures cover. Read from storage after mount (the
  // server render has no storage), so the first fetch waits for it.
  const [period, setPeriod] = useState<PeriodChoice | null>(null);
  const [draft, setDraft] = useState<DashboardPeriod>({ from: '', to: '' });
  const [periodBusy, setPeriodBusy] = useState(false);
  useEffect(() => {
    const p = readStoredPeriod();
    setPeriod(p);
    setDraft({ from: p.from, to: p.to });
  }, []);
  function applyPeriod(p: PeriodChoice) {
    setPeriod(p);
    setDraft({ from: p.from, to: p.to });
    try {
      localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* storage blocked — the choice still applies for this visit */
    }
  }

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    setPeriodBusy(true);
    // Summary + funnel are the core (an error here blocks the page); the aging
    // report and the latest orders are read-only extras, so a hiccup in either
    // simply hides its card. Old figures stay on screen while a new period
    // loads; a stale answer is dropped if the period changed again meanwhile.
    Promise.all([
      dashboardApi.summary(period),
      dashboardApi.funnel(period),
      billingReportsApi.outstanding().catch(() => null),
      ordersApi.list(undefined, 6).catch(() => null),
    ])
      .then(([sum, f, out, orders]) => {
        if (cancelled) return;
        setS(sum as Row);
        setFunnel(f as Row);
        setAging(out as Row | null);
        setRecent(Array.isArray(orders) ? orders : null);
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setPeriodBusy(false); });
    return () => { cancelled = true; };
  }, [period]);

  // Activity trend-lines — re-fetched whenever the range toggle changes. Old
  // data stays on screen while the new range loads (no flicker); the cancelled
  // guard drops a stale response if the user toggles again.
  useEffect(() => {
    let cancelled = false;
    setTrendsBusy(true);
    dashboardApi
      .trends(trendsDays)
      .then((t) => { if (!cancelled) setTrends(t); })
      .catch(() => { if (!cancelled) setTrends(null); })
      .finally(() => { if (!cancelled) setTrendsBusy(false); });
    return () => { cancelled = true; };
  }, [trendsDays]);

  if (error) return <ErrorState message={error} />;
  if (!s || !period) return <Loading label="Loading dashboard…" />;
  const inPeriod = `in the period (${periodLabel(period)})`;

  const orders = s.orders as Row,
    dispatch = s.dispatch as Row,
    billing = s.billing as Row,
    inventory = s.inventory as Row,
    production = s.production as Row;

  const funnelSteps: [string, number][] = funnel
    ? [
        ['Leads', Number(funnel.leads ?? 0)],
        ['Quotations', Number(funnel.quotations ?? 0)],
        ['Confirmed', Number(funnel.ordersConfirmed ?? 0)],
        ['Batch tickets', Number(funnel.batchTickets ?? 0)],
        ['Dispatches', Number(funnel.dispatches ?? 0)],
        ['Delivered', Number(funnel.challansDelivered ?? 0)],
        ['Invoiced', Number(funnel.invoicesIssued ?? 0)],
      ]
    : [];
  const fmax = Math.max(1, ...funnelSteps.map(([, v]) => v));

  // Hero — the four figures an owner opens the app for.
  // Hero — the four figures an owner opens the app for. Each hint says whether
  // the figure follows the period or is the position now.
  const hero: { label: string; value: ReactNode; hint: string; icon: ReactNode; tone: Tone; href: string }[] = [
    { label: 'Outstanding', value: money(billing.outstandingTotal), hint: 'Issued invoices still unpaid · now', icon: <Clock size={16} />, tone: pos(billing.outstandingTotal) ? 'warning' : 'neutral', href: '/app/billing/outstanding' },
    { label: 'Collected', value: money(billing.receiptsTotal), hint: 'Receipts recorded in the period', icon: <Wallet size={16} />, tone: 'success', href: '/app/billing/receipts' },
    { label: 'Confirmed orders', value: n(orders.confirmed), hint: 'Booked in the period', icon: <ClipboardList size={16} />, tone: 'neutral', href: '/app/orders' },
    { label: 'Dispatches active', value: n(dispatch.active), hint: 'Transit mixers on the road now', icon: <Truck size={16} />, tone: 'neutral', href: '/app/dispatch/board' },
  ];

  // Operations — the remaining counters as compact tiles. Every href kept.
  // `period` marks a count of events in the window; the rest are the position now.
  const ops: { label: string; value: ReactNode; icon: ReactNode; href: string; flag?: boolean; crit?: boolean; period?: boolean }[] = [
    { label: 'Batch tickets', value: n(production.batchTicketsConfirmed), icon: <Ticket size={15} />, href: '/app/production/batch-tickets', period: true },
    { label: 'Batched m³', value: m3(production.batchedM3), icon: <Layers size={15} />, href: '/app/production/batch-tickets', period: true },
    { label: 'Delivered m³', value: m3(dispatch.deliveredM3), icon: <Droplets size={15} />, href: '/app/dispatch/delivery-register', period: true },
    { label: 'Invoices issued', value: n(billing.invoicesIssued), icon: <ReceiptText size={15} />, href: '/app/billing/invoices', period: true },
    { label: 'Delivered · uninvoiced', value: n(dispatch.uninvoiced), icon: <PackageCheck size={15} />, href: '/app/billing/invoices', flag: pos(dispatch.uninvoiced) },
    { label: 'Credit holds', value: n(s.creditHoldsPending), icon: <Lock size={15} />, href: '/app/credit-holds', flag: pos(s.creditHoldsPending) },
    { label: 'Low stock', value: n(inventory.lowStock), icon: <TrendingDown size={15} />, href: '/app/inventory/reports', flag: pos(inventory.lowStock) },
    { label: 'Negative stock', value: n(inventory.negativeStock), icon: <AlertTriangle size={15} />, href: '/app/inventory/negative-stock', crit: pos(inventory.negativeStock) },
    { label: 'Devices', value: n(s.devices), icon: <MonitorSmartphone size={15} />, href: '/app/devices' },
  ];

  // Aging donut buckets from the outstanding report: three severity bands
  // (Current 0–30 / Ageing 31–90 / Overdue 90+), each directly labelled in the
  // legend so colour never carries meaning alone.
  const at = (aging?.totals as Row | undefined) ?? undefined;
  const ageBuckets = at
    ? [
        { key: 'current', label: 'Current · 0–30', amt: Number(at.b0_30 ?? 0) },
        { key: 'ageing', label: 'Ageing · 31–90', amt: Number(at.b31_60 ?? 0) + Number(at.b61_90 ?? 0) },
        { key: 'overdue', label: 'Overdue · 90+', amt: Number(at.b90 ?? 0) },
      ]
    : [];
  const ageTotal = ageBuckets.reduce((a, b) => a + b.amt, 0);

  // Collections gauge — the period's receipts against what is still owed now
  // (paid + still owed). Bounded [0,1] from two figures already in the hero.
  const collected = Number(billing.receiptsTotal ?? 0);
  const owed = Number(billing.outstandingTotal ?? 0);
  const collDenom = collected + owed;
  const collRate = collDenom > 0 ? collected / collDenom : 0;

  return (
    <div className="mn-dash">
      <header className="mn-dash-hero">
        <div className="mn-dash-hero-bg" aria-hidden>
          <span className="mn-dash-blob mn-dash-blob-a" />
          <span className="mn-dash-blob mn-dash-blob-b" />
          <span className="mn-dash-dots" />
        </div>
        <div className="mn-dash-hero-text">
          <span className="mn-dash-eyebrow">
            <span className="mn-dash-live" aria-hidden /> Live operations overview
          </span>
          <h1>Dashboard</h1>
          <p>Orders, batching, dispatch and billing at a glance. Every figure opens the screen behind it.</p>
          <SeverityLegend lead="Tile tones" onDark />
        </div>
        <div className="mn-dash-kpis">
          {hero.map((t) => (
            <Link key={t.label} href={t.href} className="mn-dash-kpi" data-tone={t.tone}>
              <span className="mn-dash-kpi-top">
                <span className="mn-dash-kpi-l">{t.label}</span>
                <span className="mn-dash-kpi-chip" aria-hidden>{t.icon}</span>
              </span>
              <span className="mn-dash-kpi-v">{t.value}</span>
              <span className="mn-dash-kpi-h">{t.hint} <ArrowUpRight size={12} aria-hidden /></span>
            </Link>
          ))}
        </div>
      </header>

      {/* Period bar: the event figures (booked, batched, delivered, invoiced,
          collected) follow this window; the position figures are always now. */}
      <div className="mn-dr-period mn-dash-period" role="group" aria-label="Period">
        <div className="mn-board-strip">
          {PRESETS.map((p) => {
            const on = period.key === p.key;
            return (
              <button key={p.key} type="button" className={`mn-board-chip mn-dr-chip${on ? ' is-on' : ''}`} aria-pressed={on} disabled={periodBusy} onClick={() => applyPeriod({ key: p.key, ...p.range(new Date()) })}>
                <span className="mn-board-chip-l">{p.label}</span>
              </button>
            );
          })}
          <button type="button" className={`mn-board-chip mn-dr-chip${period.key === 'custom' ? ' is-on' : ''}`} aria-pressed={period.key === 'custom'} disabled={periodBusy} onClick={() => applyPeriod({ key: 'custom', from: draft.from || period.from, to: draft.to || period.to })}>
            <span className="mn-board-chip-l">Custom</span>
          </button>
          <span className="mn-ord-meta mn-dash-period-label" aria-live="polite">{periodBusy ? 'Loading…' : periodLabel(period)}</span>
        </div>
        <form
          className="mn-dr-range"
          onSubmit={(e) => {
            e.preventDefault();
            if (YMD.test(draft.from) && YMD.test(draft.to) && draft.from <= draft.to) applyPeriod({ key: 'custom', ...draft });
          }}
        >
          <CalendarRange size={14} aria-hidden />
          <Input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="mn-ord-meta">to</span>
          <Input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Button type="submit" variant="secondary" size="sm" disabled={periodBusy || !draft.from || !draft.to || draft.from > draft.to || (draft.from === period.from && draft.to === period.to)}>Apply</Button>
        </form>
      </div>

      <div className="mn-dash-stack">
        <AlertsCard />
        <InsightsCard />
      </div>

      <div className="mn-dash-charts">
        <Card title="Order-to-cash funnel" actions={<span className="mn-ord-meta">{inPeriod}</span>}>
          <div className="mn-chart-body">
            <div className="mn-funnel">
              {funnelSteps.map(([label, val], i) => {
                const prev = funnelSteps[i - 1];
                const conv = prev && prev[1] > 0 ? Math.round((val / prev[1]) * 100) : null;
                return (
                  <div className="mn-frow" key={label} title={`${label}: ${n(val)}${conv != null ? ` · ${conv}% of previous` : ''}`}>
                    <span className="mn-fl">{label}</span>
                    <span className="mn-ftrack">
                      <span className="mn-fbar" style={{ width: `${Math.round((val / fmax) * 100)}%` }} />
                    </span>
                    <span className="mn-fv">{n(val)}</span>
                    {conv != null && <span className="mn-fconv">{conv}%</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="Outstanding by age">
          <div className="mn-chart-body">
            {ageTotal > 0 ? (
              <div className="mn-donut-wrap">
                <AgingDonut buckets={ageBuckets} total={ageTotal} />
                <div className="mn-legend">
                  {ageBuckets.map((b) => (
                    <div className="mn-lg" key={b.key}>
                      <span className={`mn-sw mn-age-${b.key}`} />
                      <span className="mn-lg-nm">{b.label}</span>
                      <span className="mn-lg-amt">{compact(b.amt)}</span>
                      <span className="mn-lg-pc">{Math.round((b.amt / ageTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mn-chart-empty">{aging === null ? 'Outstanding aging unavailable right now.' : 'No outstanding — all issued invoices are settled.'}</div>
            )}
          </div>
        </Card>

        <Card title="Collections">
          <div className="mn-chart-body">
            {collDenom > 0 ? (
              <div className="mn-gauge">
                <CollectionsGauge rate={collRate} />
                <div className="mn-gauge-big">{Math.round(collRate * 100)}%</div>
                <div className="mn-gauge-cap">{compact(collected)} collected in the period · {compact(owed)} outstanding now</div>
              </div>
            ) : (
              <div className="mn-chart-empty">No receipts or outstanding yet.</div>
            )}
          </div>
        </Card>
      </div>

      <div className="mn-dash-row2">
        <Card
          title="Activity"
          actions={
            <div className="mn-seg" role="group" aria-label="Trend range">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={trendsDays === d}
                  disabled={trendsBusy}
                  onClick={() => setTrendsDays(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          }
        >
          {trends && trends.series.length > 0 ? (
            <div className={`mn-spark-grid${trendsBusy ? ' mn-spark-grid--busy' : ''}`}>
              {trends.series.map((sr) => (
                <Sparkline key={sr.key} series={sr} />
              ))}
            </div>
          ) : (
            <div className="mn-chart-empty">{trends === null && !trendsBusy ? 'Activity trends unavailable right now.' : 'No activity in this range yet.'}</div>
          )}
        </Card>

        <Card
          title="Latest orders"
          actions={
            <Link href="/app/orders" className="mn-dash-more">
              All orders <ArrowUpRight size={14} aria-hidden />
            </Link>
          }
        >
          {recent && recent.length > 0 ? (
            <div className="mn-dash-orders">
              {recent.map((r) => (
                <Link key={String(r.id)} href={`/app/orders/${r.id}`} className="mn-dash-order">
                  <span className="mn-dash-order-no">{String(r.orderNo ?? '')}</span>
                  <span className="mn-dash-order-c">
                    <span className="mn-dash-order-cust">{String(r.customerName ?? '—')}</span>
                    <span className="mn-dash-order-d">{formatDate(r.orderDate)}</span>
                  </span>
                  <span className="mn-dash-order-amt">{money(r.estimatedOrderValue)}</span>
                  <StatusBadge status={String(r.orderStatus ?? '')} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="mn-chart-empty">{recent === null ? 'Orders unavailable right now.' : 'No orders yet — the first one shows here.'}</div>
          )}
        </Card>
      </div>

      <div className="mn-ops-head">
        <h2>Operations</h2>
        <span>— tap any tile to open it. Counts of events are for the period; the rest are the position now.</span>
      </div>
      <div className="mn-ops">
        {ops.map((o) => (
          <Link key={o.label} href={o.href} className={`mn-op${o.flag ? ' mn-op-flag' : ''}${o.crit ? ' mn-op-crit' : ''}`}>
            <span className="mn-op-l">{o.icon}{o.label}</span>
            <span className="mn-op-v">{o.value}</span>
            <span className="mn-op-h">{o.period ? 'in the period' : 'now'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Three-segment severity donut (inline SVG, no chart lib). Rotated so the arc
 *  starts at 12 o'clock; 6px gaps between segments read as a hairline break. */
function AgingDonut({ buckets, total }: { buckets: { key: string; label: string; amt: number }[]; total: number }) {
  const r = 52, cx = 66, cy = 66, circ = 2 * Math.PI * r, gap = 6;
  let off = 0;
  return (
    <div className="mn-donut">
      <svg width="132" height="132" viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--mn-donut-track)" strokeWidth="15" />
        {buckets.map((b) => {
          const frac = b.amt / total;
          const len = Math.max(frac * circ - gap, b.amt > 0 ? 2 : 0);
          const el = (
            <circle
              key={b.key}
              cx={cx} cy={cy} r={r} fill="none"
              className={`mn-age-${b.key}`}
              stroke="currentColor" strokeWidth="15"
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-off}
              strokeLinecap="round"
            >
              <title>{`${b.label.split(' · ')[0]}: ₹${(b.amt / 100000).toFixed(2)}L (${Math.round(frac * 100)}%)`}</title>
            </circle>
          );
          off += frac * circ;
          return el;
        })}
      </svg>
      <div className="mn-donut-c">
        <div className="mn-donut-t">Total</div>
        <div className="mn-donut-v">{compact(total)}</div>
      </div>
    </div>
  );
}

/** 270° collections arc (inline SVG). One series, single hue — no palette. */
function CollectionsGauge({ rate }: { rate: number }) {
  const cx = 75, cy = 80, R = 58, start = Math.PI * 0.75, sweep = Math.PI * 1.5;
  const pt = (ang: number) => [cx + R * Math.cos(ang), cy + R * Math.sin(ang)];
  const arc = (a0: number, a1: number) => {
    const s = pt(a0), e = pt(a1), large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${s[0]} ${s[1]} A${R} ${R} 0 ${large} 1 ${e[0]} ${e[1]}`;
  };
  return (
    <svg width="150" height="96" viewBox="0 0 150 96" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="mn-gauge-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mn-gauge-a)" />
          <stop offset="1" stopColor="var(--mn-gauge-b)" />
        </linearGradient>
      </defs>
      <path d={arc(start, start + sweep)} fill="none" stroke="var(--mn-donut-track)" strokeWidth="12" strokeLinecap="round" />
      <path d={arc(start, start + sweep * Math.max(0, Math.min(1, rate)))} fill="none" stroke="url(#mn-gauge-g)" strokeWidth="12" strokeLinecap="round" />
    </svg>
  );
}

/** One small-multiple sparkline: window total + a normalized line/area over the
 *  dense daily points. Single series → single hue (no categorical palette). The
 *  line is `non-scaling-stroke` so the stretched viewBox keeps it a crisp 2px. */
function Sparkline({ series }: { series: TrendSeries }) {
  const pts = series.points;
  const vals = pts.map((p) => p.v);
  const len = pts.length;
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const W = 220, H = 44, pad = 3;
  const x = (i: number) => (len <= 1 ? pad : (i / (len - 1)) * (W - pad * 2) + pad);
  const y = (v: number) => H - pad - (max === min ? 0 : (v - min) / (max - min)) * (H - pad * 2);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = len ? `${line} L${x(len - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z` : '';
  const total = vals.reduce((a, b) => a + b, 0);
  const totalLabel = series.unit === 'inr' ? compact(total) : n(total);
  const gid = `mn-spark-${series.key}`;
  return (
    <div className="mn-spark" title={`${series.label}: ${totalLabel} over ${len} days`}>
      <div className="mn-spark-top">
        <span className="mn-spark-lbl">{series.label}</span>
        <span className="mn-spark-val">{totalLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mn-spark-svg" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--mn-gauge-a)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--mn-gauge-a)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#${gid})`} />}
        <path d={line} fill="none" stroke="var(--mn-gauge-a)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
