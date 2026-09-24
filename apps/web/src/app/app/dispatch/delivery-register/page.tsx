'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarRange, FileText, Receipt, RefreshCw, RotateCcw, Timer, Truck } from 'lucide-react';
import { currentMonthRange, settledFailure, settledReason, settledValue, todayLocal } from '../../../../lib/report-range';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { challansApi, dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Delivery register — the supply record, day by day.
 *
 * A period bar (today / this week / this month / last month / all time, or
 * any two dates) sets the window; five tiles sum it up (delivered, challans,
 * returned, customers served, average turnaround); notes flag concrete that
 * came back and delivered loads not yet invoiced. The register lists every
 * delivered challan under its day with a day subtotal: the challan and when
 * it left, the customer and site, the grade, the truck and driver, loaded,
 * returned and delivered m³, and the invoice that bills it. Cycle times for
 * the completed trips in the same window sit below. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const m3 = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const mins = (v: unknown) => (v == null ? '—' : `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} min`);

type Range = { from: string; to: string };
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** The quick windows a plant checks: each is a pure function of "now". */
const PRESETS: Array<{ key: string; label: string; range: (now: Date) => Range }> = [
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
  {
    key: 'last',
    label: 'Last month',
    range: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }),
  },
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
];

/** "Mon 22 Sep 2026" from a bare YYYY-MM-DD, without a timezone shift. */
function dayLabel(date: unknown) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return formatDate(date);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DeliveryRegisterPage() {
  const [data, setData] = useState<{ rows: Row[]; totalM3: number; returnedM3?: number; count: number } | null>(null);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [cycle, setCycle] = useState<{ rows: Row[]; averages: Row; count: number } | null>(null);
  // Opens on the current month rather than every challan ever — see report-range.ts.
  const [range, setRange] = useState<Range>(currentMonthRange());
  const [draft, setDraft] = useState<Range>(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      // allSettled: a register too wide for its cap must not also hide the
      // cycle times, which answered fine.
      const out = await Promise.allSettled([
        challansApi.deliveryRegister({ from: r.from || undefined, to: r.to || undefined }),
        dispatchApi.cycleTimes(r.from || undefined, r.to || undefined),
      ]);
      setData(settledValue(out[0]));
      setCycle(settledValue(out[1]));
      setFailed(out.map(settledReason));
      const why = settledFailure(out);
      if (why) setError(why);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, []);

  // The first paint reads the mount-time window; later loads go through apply().
  useEffect(() => {
    load(currentMonthRange()).catch((e) => setError(String(e)));
  }, [load]);

  function apply(r: Range) {
    setRange(r);
    setDraft(r);
    load(r).catch((e) => setError(String(e)));
  }

  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;

  const rows = data?.rows ?? [];
  const summary = useMemo(() => {
    const customers = new Set(rows.map((r) => String(r.customerName ?? '')).filter(Boolean));
    const returnedLoads = rows.filter((r) => num(r.returnedM3) > 0);
    const returnedM3 = data?.returnedM3 ?? returnedLoads.reduce((t, r) => t + num(r.returnedM3), 0);
    const unbilled = rows.filter((r) => String(r.invoiceStatus ?? '') !== 'invoiced');
    return { customers: customers.size, returnedLoads: returnedLoads.length, returnedM3, unbilled: unbilled.length, unbilledM3: unbilled.reduce((t, r) => t + num(r.delivered), 0) };
  }, [rows, data]);

  /** Rows under their day, newest day first (the API already sorts that way). */
  const days = useMemo(() => {
    const out: Array<{ date: string; rows: Row[]; m3: number }> = [];
    for (const r of rows) {
      const key = String(r.date ?? '');
      const last = out[out.length - 1];
      if (last && last.date === key) { last.rows.push(r); last.m3 += num(r.delivered); }
      else out.push({ date: key, rows: [r], m3: num(r.delivered) });
    }
    return out;
  }, [rows]);

  const periodLabel = range.from || range.to
    ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}`
    : 'all time';

  return (
    <div className="mn-ord mn-dr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Delivery register</h1>
          <p>Concrete delivered net of returns, one line per signed challan, day by day: the supply record the plant diary, the customer statements and the invoices are reconciled against.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Truck size={14} aria-hidden />
            {data ? `${data.count} ${data.count === 1 ? 'challan' : 'challans'} · ${m3(data.totalM3)} m³` : 'Loading…'}
          </span>
          <Link href="/app/dispatch/challans" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<FileText size={14} />}>Delivery challans</Button>
          </Link>
          <ExportButton
            rows={rows}
            columns={['date', 'challanNo', 'dispatchTime', 'customerName', 'siteName', 'gradeLabel', 'vehicleNo', 'driverName', 'loadedM3', 'returnedM3', 'returnReason', 'delivered', 'receiverName', 'invoiceStatus', 'invoiceNo']}
            filename="delivery-register"
          />
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Period bar: the quick windows as chips, or any two dates. */}
      <div className="mn-dr-period" role="group" aria-label="Period">
        <div className="mn-board-strip">
          {PRESETS.map((p) => {
            const on = activePreset === p.key;
            return (
              <button key={p.key} type="button" className={`mn-board-chip mn-dr-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => apply(p.range(new Date()))}>
                <span className="mn-board-chip-l">{p.label}</span>
              </button>
            );
          })}
        </div>
        <form
          className="mn-dr-range"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <CalendarRange size={14} aria-hidden />
          <Input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="mn-ord-meta">to</span>
          <Input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Button type="submit" variant="secondary" size="sm" disabled={busy || (draft.from === range.from && draft.to === range.to)}>Apply</Button>
        </form>
      </div>

      {(summary.returnedLoads > 0 || summary.unbilled > 0) && (
        <div className="mn-ord-notes">
          {summary.returnedLoads > 0 && (
            <Link className="mn-ord-note mn-ord-note--warn" href="/app/dispatch/challans#wastage">
              <RotateCcw size={16} aria-hidden />
              <span>
                <strong>{m3(summary.returnedM3)} m³ came back on {summary.returnedLoads} {summary.returnedLoads === 1 ? 'load' : 'loads'} in this period.</strong>{' '}
                The register counts what was placed; the returned-concrete breakdown is under Delivery challans.
              </span>
            </Link>
          )}
          {summary.unbilled > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <Receipt size={16} aria-hidden />
              <span>
                <strong>{summary.unbilled} delivered {summary.unbilled === 1 ? 'challan' : 'challans'} ({m3(summary.unbilledM3)} m³) not invoiced yet.</strong>{' '}
                Raise the invoices from <Link href="/app/billing/invoices">Billing → Invoices</Link> (From challans).
              </span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Delivered" value={data ? `${m3(data.totalM3)} m³` : '—'} tone="info" />
        <StatCard label="Challans" value={data ? String(data.count) : '—'} />
        <StatCard label="Returned" value={data ? `${m3(summary.returnedM3)} m³` : '—'} tone={summary.returnedM3 > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Customers served" value={data ? String(summary.customers) : '—'} />
        <StatCard label="Avg turnaround" value={cycle?.averages?.turnaroundMin == null ? '—' : mins(cycle.averages.turnaroundMin)} tone={cycle?.averages?.turnaroundMin == null ? 'neutral' : 'info'} />
      </div>

      <Card
        title={<span className="mn-board-card-title"><BookOpen size={16} aria-hidden /> Register <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={<span className="mn-ord-how">{periodLabel} · by the day the load left the plant</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rows.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Challan</Th>
                  <Th>Customer</Th>
                  <Th>Grade</Th>
                  <Th>Truck</Th>
                  <Th numeric>Loaded</Th>
                  <Th numeric>Returned</Th>
                  <Th numeric>Delivered m³</Th>
                  <Th>Billing</Th>
                </tr>
              </thead>
              {days.map((day) => (
                <tbody key={day.date}>
                  <tr className="mn-dr-day">
                    <Td colSpan={6}><span className="mn-dr-day-label">{dayLabel(day.date)}</span><span className="mn-ord-meta"> · {day.rows.length} {day.rows.length === 1 ? 'challan' : 'challans'}</span></Td>
                    <Td numeric><span className="mn-dr-day-m3">{m3(day.m3)}</span></Td>
                    <Td />
                  </tr>
                  {day.rows.map((r) => {
                    const returned = num(r.returnedM3);
                    const invoiced = String(r.invoiceStatus ?? '') === 'invoiced';
                    return (
                      <tr key={String(r.challanId ?? r.challanNo)}>
                        <Td>
                          {r.challanId ? <Link href={`/app/dispatch/challans/${String(r.challanId)}`} className="mn-id-link">{String(r.challanNo)}</Link> : <span className="mn-od-num">{String(r.challanNo)}</span>}
                          <span className="mn-od-rate-meta">{r.dispatchTime ? `Out ${formatDateTime(r.dispatchTime).slice(11)}` : 'Time out not stamped'}{r.receiverName ? ` · signed ${String(r.receiverName)}` : ''}</span>
                        </Td>
                        <Td>
                          <span className="mn-od-num">{String(r.customerName ?? '—')}</span>
                          {r.siteName ? <span className="mn-od-rate-meta">{String(r.siteName)}</span> : null}
                        </Td>
                        <Td><span className="mn-od-grade">{String(r.gradeLabel ?? '—')}</span></Td>
                        <Td>
                          <span>{String(r.vehicleNo ?? '—')}</span>
                          {r.driverName ? <span className="mn-od-rate-meta">{String(r.driverName)}</span> : null}
                        </Td>
                        <Td numeric>{m3(r.loadedM3)}</Td>
                        <Td numeric>
                          {returned > 0 ? <span className="mn-dr-ret">{m3(returned)}</span> : '—'}
                          {returned > 0 && r.returnReason ? <span className="mn-od-rate-meta">{String(r.returnReason)}</span> : null}
                        </Td>
                        <Td numeric><span className="mn-od-num">{m3(r.delivered)}</span></Td>
                        <Td>
                          {invoiced
                            ? (r.invoiceId ? <Link href={`/app/billing/invoices/${String(r.invoiceId)}`} className="mn-id-link">{String(r.invoiceNo ?? 'Invoice')}</Link> : <Badge tone="success">Invoiced</Badge>)
                            : <Badge tone="warning">To invoice</Badge>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              {data && (
                <tfoot>
                  <tr className="mn-dr-total">
                    <Td colSpan={4}>Total for {periodLabel}</Td>
                    <Td numeric>{m3(rows.reduce((t, r) => t + num(r.loadedM3), 0))}</Td>
                    <Td numeric>{summary.returnedM3 > 0 ? m3(summary.returnedM3) : '—'}</Td>
                    <Td numeric><span className="mn-dr-total-m3">{m3(data.totalM3)}</span></Td>
                    <Td />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : failed[0] ? (
          <ErrorState message={failed[0] ?? 'This report did not load.'} />
        ) : (
          <EmptyState title="No deliveries in this period" description="Challans signed for on site appear here under the day the load left the plant. Widen the period or check the Dispatch board for loads still on the road." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Timer size={16} aria-hidden /> Cycle times <span className="mn-board-card-count">{cycle?.count ?? 0}</span></span>}
        actions={<ExportButton rows={cycle?.rows ?? []} columns={['dispatchNo', 'gradeLabel', 'travelMin', 'waitMin', 'pourMin', 'turnaroundMin']} filename="dispatch-cycle-times" />}
        padded={false}
      >
        {cycle?.averages ? (
          <div className="mn-dc-wsum mn-dr-avg">
            <span>Travel <strong>{mins(cycle.averages.travelMin)}</strong></span>
            <span>On-site wait <strong>{mins(cycle.averages.waitMin)}</strong></span>
            <span>Pour <strong>{mins(cycle.averages.pourMin)}</strong></span>
            <span>Turnaround <strong>{mins(cycle.averages.turnaroundMin)}</strong></span>
            <span className="mn-ord-meta">averages over the completed trips in this period; a leg shows — until both of its times are stamped on the board</span>
          </div>
        ) : null}
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : cycle?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Dispatch</Th>
                  <Th>Grade</Th>
                  <Th numeric>Travel</Th>
                  <Th numeric>On-site wait</Th>
                  <Th numeric>Pour</Th>
                  <Th numeric>Turnaround</Th>
                </tr>
              </thead>
              <tbody>
                {cycle.rows.map((r, i) => (
                  <tr key={`${String(r.dispatchNo)}-${i}`}>
                    <Td><span className="mn-od-num">{String(r.dispatchNo)}</span></Td>
                    <Td><span className="mn-od-grade">{String(r.gradeLabel ?? '—')}</span></Td>
                    <Td numeric>{mins(r.travelMin)}</Td>
                    <Td numeric>{mins(r.waitMin)}</Td>
                    <Td numeric>{mins(r.pourMin)}</Td>
                    <Td numeric><span className="mn-od-num">{mins(r.turnaroundMin)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : failed[1] ? (
          <ErrorState message={failed[1] ?? 'This report did not load.'} />
        ) : (
          <EmptyState title="No completed trips in this period" description="A trip counts once its dispatch reaches Completed on the board; travel, wait, pour and turnaround come from the times stamped on the way." />
        )}
      </Card>
    </div>
  );
}
