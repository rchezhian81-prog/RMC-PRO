'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ClipboardList, Lock, Ticket, Truck, PackageCheck, ReceiptText, Clock, Wallet, TrendingDown,
  AlertTriangle, MonitorSmartphone, ChevronRight,
} from 'lucide-react';
import { dashboardApi, billingReportsApi, type Row, type TrendsResult, type TrendSeries } from '../../../lib/api';
import { StatCard } from '../../../components/ui/StatCard';
import { Card } from '../../../components/ui/Card';
import { AlertsCard } from '../../../components/AlertsCard';
import { InsightsCard } from '../../../components/InsightsCard';
import { Loading, ErrorState } from '../../../components/ui/States';
import { CommandBar } from '../../../components/ui/CommandBar';
import { SummaryStrip } from '../../../components/ui/SummaryStrip';
import { Surface } from '../../../components/ui/Surface';
import type { Tone } from '../../../components/ui/Badge';
import { isUiV2 } from '../../../lib/ui-flag';

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

export default function DashboardPage() {
  const [s, setS] = useState<Row | null>(null);
  const [funnel, setFunnel] = useState<Row | null>(null);
  const [aging, setAging] = useState<Row | null>(null);
  const [trends, setTrends] = useState<TrendsResult | null>(null);
  const [trendsDays, setTrendsDays] = useState(30);
  const [trendsBusy, setTrendsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Flag-OFF makes exactly the two calls it always has. V2 adds the existing
    // outstanding-aging report (donut) — read-only and resilient, so a hiccup
    // never blocks the core dashboard. Trends is fetched separately (below) so
    // the range toggle can re-fetch it without re-loading the rest.
    const v2 = isUiV2();
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.funnel(),
      v2 ? billingReportsApi.outstanding().catch(() => null) : Promise.resolve(null),
    ])
      .then(([sum, f, out]) => {
        setS(sum as Row);
        setFunnel(f as Row);
        setAging(out as Row | null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Activity trend-lines — re-fetched whenever the range toggle changes (V2 only,
  // resilient). Old data stays on screen while the new range loads, so there's no
  // flicker; the cancelled guard drops a stale response if the user toggles again.
  useEffect(() => {
    if (!isUiV2()) return;
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

  // ---- Legacy (flag-OFF) — unchanged from before, byte-for-byte behaviour. ----
  if (!isUiV2()) {
    const tiles: { label: string; value: ReactNode; icon: ReactNode; tone: Tone; href: string }[] = [
      { label: 'Confirmed orders', value: n(orders.confirmed), icon: <ClipboardList size={16} />, tone: 'success', href: '/app/orders' },
      { label: 'Credit holds pending', value: n(s.creditHoldsPending), icon: <Lock size={16} />, tone: pos(s.creditHoldsPending) ? 'warning' : 'neutral', href: '/app/credit-holds' },
      { label: 'Batch tickets', value: n(production.batchTicketsConfirmed), icon: <Ticket size={16} />, tone: 'info', href: '/app/production/batch-tickets' },
      { label: 'Dispatches active', value: n(dispatch.active), icon: <Truck size={16} />, tone: 'info', href: '/app/dispatch/board' },
      { label: 'Delivered (uninvoiced)', value: n(dispatch.uninvoiced), icon: <PackageCheck size={16} />, tone: pos(dispatch.uninvoiced) ? 'info' : 'neutral', href: '/app/billing/invoices' },
      { label: 'Invoices issued', value: n(billing.invoicesIssued), icon: <ReceiptText size={16} />, tone: 'neutral', href: '/app/billing/invoices' },
      { label: 'Outstanding', value: money(billing.outstandingTotal), icon: <Clock size={16} />, tone: pos(billing.outstandingTotal) ? 'warning' : 'neutral', href: '/app/billing/outstanding' },
      { label: 'Receipts total', value: money(billing.receiptsTotal), icon: <Wallet size={16} />, tone: 'success', href: '/app/billing/receipts' },
      { label: 'Low stock', value: n(inventory.lowStock), icon: <TrendingDown size={16} />, tone: pos(inventory.lowStock) ? 'warning' : 'neutral', href: '/app/inventory/reports' },
      { label: 'Negative stock', value: n(inventory.negativeStock), icon: <AlertTriangle size={16} />, tone: pos(inventory.negativeStock) ? 'danger' : 'neutral', href: '/app/inventory/negative-stock' },
      { label: 'Devices', value: n(s.devices), icon: <MonitorSmartphone size={16} />, tone: 'neutral', href: '/app/devices' },
    ];
    return (
      <div style={{ display: 'grid', gap: 18 }}>
        <CommandBar title="Dashboard" subtitle="Live operations overview — Mix Nova RMC Software" />
        <div style={{ display: 'grid', gap: 14 }}>
          <AlertsCard />
          <InsightsCard />
        </div>
        <SummaryStrip>
          {tiles.map((t) => (
            <StatCard key={t.label} label={t.label} value={t.value} icon={t.icon} tone={t.tone} href={t.href} />
          ))}
        </SummaryStrip>
        <Surface variant="command" padded>
          <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--mn-font-display)', fontSize: 15, letterSpacing: '-0.01em' }}>
            Order-to-cash funnel
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {funnelSteps.map(([label, val], i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  className="mn-surface"
                  style={{ boxShadow: 'var(--mn-elev-command)', borderRadius: 'var(--mn-radius-md)', padding: '10px 16px', textAlign: 'center', minWidth: 96 }}
                >
                  <div style={{ fontFamily: 'var(--mn-font-display)', fontSize: 20, fontWeight: 700 }}>{n(val)}</div>
                  <div style={{ fontSize: 11, color: 'var(--mn-muted)', marginTop: 2 }}>{label}</div>
                </div>
                {i < funnelSteps.length - 1 && <ChevronRight size={16} color="var(--mn-subtle)" />}
              </div>
            ))}
          </div>
        </Surface>
      </div>
    );
  }

  // =====================================================================
  // V2 — Owner command centre, redesigned: pruned 4-KPI hero, three
  // data-backed charts (funnel / aging donut / collections gauge), and a
  // compact operations grid for the rest. PRESENTATION ONLY — every value
  // and href is the same data the legacy dashboard already used; the aging
  // donut reads the existing outstanding report; nothing new server-side.
  // =====================================================================

  // Hero — the four figures an owner opens the app for.
  const hero: { label: string; value: ReactNode; icon: ReactNode; tone: Tone; href: string }[] = [
    { label: 'Outstanding', value: money(billing.outstandingTotal), icon: <Clock size={16} />, tone: pos(billing.outstandingTotal) ? 'warning' : 'neutral', href: '/app/billing/outstanding' },
    { label: 'Collected (receipts)', value: money(billing.receiptsTotal), icon: <Wallet size={16} />, tone: 'success', href: '/app/billing/receipts' },
    { label: 'Confirmed orders', value: n(orders.confirmed), icon: <ClipboardList size={16} />, tone: 'success', href: '/app/orders' },
    { label: 'Dispatches active', value: n(dispatch.active), icon: <Truck size={16} />, tone: 'info', href: '/app/dispatch/board' },
  ];

  // Operations — the rest, demoted to compact tiles. Every original href kept.
  const ops: { label: string; value: ReactNode; icon: ReactNode; href: string; flag?: boolean; crit?: boolean }[] = [
    { label: 'Batch tickets', value: n(production.batchTicketsConfirmed), icon: <Ticket size={15} />, href: '/app/production/batch-tickets' },
    { label: 'Delivered · uninvoiced', value: n(dispatch.uninvoiced), icon: <PackageCheck size={15} />, href: '/app/billing/invoices' },
    { label: 'Invoices issued', value: n(billing.invoicesIssued), icon: <ReceiptText size={15} />, href: '/app/billing/invoices' },
    { label: 'Credit holds', value: n(s.creditHoldsPending), icon: <Lock size={15} />, href: '/app/credit-holds', flag: pos(s.creditHoldsPending) },
    { label: 'Low stock', value: n(inventory.lowStock), icon: <TrendingDown size={15} />, href: '/app/inventory/reports', flag: pos(inventory.lowStock) },
    { label: 'Negative stock', value: n(inventory.negativeStock), icon: <AlertTriangle size={15} />, href: '/app/inventory/negative-stock', crit: pos(inventory.negativeStock) },
    { label: 'Devices', value: n(s.devices), icon: <MonitorSmartphone size={15} />, href: '/app/devices' },
  ];

  const fmax = Math.max(1, ...funnelSteps.map(([, v]) => v));

  // Aging donut buckets from the existing outstanding report: three severity
  // bands (Current 0–30 / Ageing 31–90 / Overdue 90+). Directly labelled in the
  // legend, so colour never carries meaning alone.
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
  // collected. Bounded [0,1] from two figures already on the hero above.
  const collected = Number(billing.receiptsTotal ?? 0);
  const owed = Number(billing.outstandingTotal ?? 0);
  const collDenom = collected + owed;
  const collRate = collDenom > 0 ? collected / collDenom : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <CommandBar title="Dashboard" subtitle="Live operations overview — Mix Nova RMC Software" />

      <div style={{ display: 'grid', gap: 14 }}>
        <AlertsCard />
        <InsightsCard />
      </div>

      <SummaryStrip>
        {hero.map((t) => (
          <StatCard key={t.label} label={t.label} value={t.value} icon={t.icon} tone={t.tone} href={t.href} />
        ))}
      </SummaryStrip>

      <div className="mn-charts">
        <Card title="Order-to-cash funnel">
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
        </Card>

        <Card title="Outstanding by age">
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
        </Card>

        <Card title="Collections">
          {collDenom > 0 ? (
            <div className="mn-gauge">
              <CollectionsGauge rate={collRate} />
              <div className="mn-gauge-big">{Math.round(collRate * 100)}%</div>
              <div className="mn-gauge-cap">{compact(collected)} collected · {compact(owed)} outstanding</div>
            </div>
          ) : (
            <div className="mn-chart-empty">No receipts or outstanding yet.</div>
          )}
        </Card>
      </div>

      {trends && trends.series.length > 0 && (
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
          <div className={`mn-spark-grid${trendsBusy ? ' mn-spark-grid--busy' : ''}`}>
            {trends.series.map((sr) => (
              <Sparkline key={sr.key} series={sr} />
            ))}
          </div>
        </Card>
      )}

      <div className="mn-ops-head">
        <h2>Operations</h2>
        <span>— tap any tile to open it</span>
      </div>
      <div className="mn-ops">
        {ops.map((o) => (
          <a key={o.label} href={o.href} className={`mn-op${o.flag ? ' mn-op-flag' : ''}${o.crit ? ' mn-op-crit' : ''}`}>
            <span className="mn-op-l">{o.icon}{o.label}</span>
            <span className="mn-op-v">{o.value}</span>
          </a>
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
        <div className="mn-donut-t">Outstanding</div>
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
