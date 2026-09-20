'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ClipboardList, Lock, Ticket, Truck, PackageCheck, ReceiptText, Clock, Wallet, TrendingDown,
  AlertTriangle, MonitorSmartphone, ArrowUpRight,
} from 'lucide-react';
import {
  dashboardApi, billingReportsApi, ordersApi, type Row, type TrendsResult, type TrendSeries,
} from '../../../lib/api';
import { formatDate } from '../../../lib/format-date';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { AlertsCard } from '../../../components/AlertsCard';
import { InsightsCard } from '../../../components/InsightsCard';
import { Loading, ErrorState } from '../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');
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
  const [s, setS] = useState<Row | null>(null);
  const [funnel, setFunnel] = useState<Row | null>(null);
  const [aging, setAging] = useState<Row | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [trends, setTrends] = useState<TrendsResult | null>(null);
  const [trendsDays, setTrendsDays] = useState(30);
  const [trendsBusy, setTrendsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Summary + funnel are the core (an error here blocks the page); the aging
    // report and the latest orders are read-only extras, so a hiccup in either
    // simply hides its card.
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.funnel(),
      billingReportsApi.outstanding().catch(() => null),
      ordersApi.list(undefined, 6).catch(() => null),
    ])
      .then(([sum, f, out, orders]) => {
        setS(sum as Row);
        setFunnel(f as Row);
        setAging(out as Row | null);
        setRecent(Array.isArray(orders) ? orders : null);
      })
      .catch((e) => setError(String(e)));
  }, []);

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
  if (!s) return <Loading label="Loading dashboard…" />;

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
  const hero: { label: string; value: ReactNode; hint: string; icon: ReactNode; tone: Tone; href: string }[] = [
    { label: 'Outstanding', value: money(billing.outstandingTotal), hint: 'Issued invoices still unpaid', icon: <Clock size={16} />, tone: pos(billing.outstandingTotal) ? 'warning' : 'neutral', href: '/app/billing/outstanding' },
    { label: 'Collected', value: money(billing.receiptsTotal), hint: 'Receipts recorded to date', icon: <Wallet size={16} />, tone: 'success', href: '/app/billing/receipts' },
    { label: 'Confirmed orders', value: n(orders.confirmed), hint: 'Ready for planning and batching', icon: <ClipboardList size={16} />, tone: 'neutral', href: '/app/orders' },
    { label: 'Dispatches active', value: n(dispatch.active), hint: 'Transit mixers on the road now', icon: <Truck size={16} />, tone: 'neutral', href: '/app/dispatch/board' },
  ];

  // Operations — the remaining counters as compact tiles. Every href kept.
  const ops: { label: string; value: ReactNode; icon: ReactNode; href: string; flag?: boolean; crit?: boolean }[] = [
    { label: 'Batch tickets', value: n(production.batchTicketsConfirmed), icon: <Ticket size={15} />, href: '/app/production/batch-tickets' },
    { label: 'Delivered · uninvoiced', value: n(dispatch.uninvoiced), icon: <PackageCheck size={15} />, href: '/app/billing/invoices', flag: pos(dispatch.uninvoiced) },
    { label: 'Invoices issued', value: n(billing.invoicesIssued), icon: <ReceiptText size={15} />, href: '/app/billing/invoices' },
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

  // Collections gauge — share of what has come due (paid + still owed) that is
  // collected. Bounded [0,1] from two figures already in the hero.
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

      <div className="mn-dash-stack">
        <AlertsCard />
        <InsightsCard />
      </div>

      <div className="mn-dash-charts">
        <Card title="Order-to-cash funnel">
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
                <div className="mn-gauge-cap">{compact(collected)} collected · {compact(owed)} outstanding</div>
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
        <span>— tap any tile to open it</span>
      </div>
      <div className="mn-ops">
        {ops.map((o) => (
          <Link key={o.label} href={o.href} className={`mn-op${o.flag ? ' mn-op-flag' : ''}${o.crit ? ' mn-op-crit' : ''}`}>
            <span className="mn-op-l">{o.icon}{o.label}</span>
            <span className="mn-op-v">{o.value}</span>
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
