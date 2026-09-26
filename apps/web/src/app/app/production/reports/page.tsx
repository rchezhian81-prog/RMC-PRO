'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, CalendarRange, ClipboardList, FlaskConical, Package, RefreshCw, Scale, ScrollText } from 'lucide-react';
import { currentMonthRange, settledFailure, settledReason, settledValue, todayLocal } from '../../../../lib/report-range';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { productionReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Production reports — what the plant made and what it took.
 *
 * Five tiles sum the period up (batches, m³ produced, grades, batches that
 * broke tolerance, and the material value they used at standard rates); a
 * note names the batches outside tolerance; a period bar (today / this week /
 * this month / last month / all time, or any two dates) bounds everything
 * but the breach list. Then the story: by grade (produced against what was
 * planned), the batch register day by day (each ticket a link, with whom it
 * was mixed for and who ran it), the material consumption with each
 * material's share and value, the reconciliation (recipe target vs what the
 * controller dosed vs what left the books), and the tolerance breaches per
 * batch. Each card checks its own settled slot first, so a refused report
 * says so instead of "No …". Same layout in both skins; every colour reads
 * the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const m3 = (v: unknown) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m³`;
const signed = (v: unknown, unit = '') => (Math.abs(num(v)) < 1e-9 ? '—' : `${num(v) > 0 ? '+' : '−'}${qty(Math.abs(num(v)))}${unit}`);
const pct = (v: unknown) => (v == null || v === '' ? '' : ` (${num(v) > 0 ? '+' : ''}${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%)`);

type Range = { from: string; to: string };
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PRESETS: Array<{ key: string; label: string; range: (now: Date) => Range }> = [
  { key: 'today', label: 'Today', range: (now) => ({ from: todayLocal(now), to: todayLocal(now) }) },
  {
    key: 'week',
    label: 'This week',
    range: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return { from: ymd(d), to: todayLocal(now) };
    },
  },
  { key: 'month', label: 'This month', range: (now) => currentMonthRange(now) },
  { key: 'last', label: 'Last month', range: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }) },
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
];

function dayLabel(ymdStr: string, now = new Date()) {
  if (ymdStr === todayLocal(now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (ymdStr === todayLocal(y)) return 'Yesterday';
  return formatDate(ymdStr);
}

export default function ProductionReportsPage() {
  const [byGrade, setByGrade] = useState<Row[]>([]);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [variance, setVariance] = useState<Row[]>([]);
  const [consumption, setConsumption] = useState<Row[]>([]);
  const [recon, setRecon] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [batch, setBatch] = useState<{ rows: Row[]; totalM3: number; count: number } | null>(null);
  const [pva, setPva] = useState<{ rows: Row[]; totals: Row } | null>(null);
  // Opens on the current month rather than every batch ever produced.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      const from = r.from || undefined;
      const to = r.to || undefined;
      // allSettled: six independent reports — one failing must not blank five
      // that answered.
      const out = await Promise.allSettled([
        productionReportsApi.summary(from, to),
        productionReportsApi.variance(),
        productionReportsApi.consumption(from, to),
        productionReportsApi.batchRegister(from, to),
        productionReportsApi.planVsActual(from, to),
        productionReportsApi.reconciliation(from, to),
      ]);
      const summary = settledValue(out[0]);
      setByGrade((summary?.byGrade as Row[]) ?? []);
      setTotals((summary?.totals as Row) ?? null);
      setVariance(settledValue(out[1]) ?? []);
      setConsumption(settledValue(out[2]) ?? []);
      setBatch(settledValue(out[3]));
      setPva(settledValue(out[4]));
      setRecon(settledValue(out[5]));
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
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';

  // By grade: what was produced next to what was planned, one row per grade
  // seen in either report (a grade planned but never batched still shows).
  const grades = useMemo(() => {
    const planned = new Map((pva?.rows ?? []).map((r) => [String(r.gradeLabel ?? 'Unspecified'), r]));
    const rows = byGrade.map((g) => {
      const label = String(g.grade ?? 'Unspecified');
      const p = planned.get(label);
      planned.delete(label);
      return { label, batches: num(g.batches), produced: num(g.producedM3), breached: num(g.varianceBatches), planned: p ? num(p.plannedM3) : null };
    });
    for (const [label, p] of planned) rows.push({ label, batches: 0, produced: num(p.actualM3), breached: 0, planned: num(p.plannedM3) });
    return rows.sort((a, b) => b.produced - a.produced);
  }, [byGrade, pva]);

  const days = useMemo(() => {
    const map = new Map<string, { date: string; rows: Row[]; m3: number }>();
    for (const r of batch?.rows ?? []) {
      const d = String(r.date ?? '').slice(0, 10);
      const g = map.get(d) ?? { date: d, rows: [], m3: 0 };
      g.rows.push(r);
      g.m3 += num(r.m3);
      map.set(d, g);
    }
    return [...map.values()];
  }, [batch]);

  const consumed = useMemo(() => consumption.reduce((t, r) => ({ value: t.value + num(r.value), unpriced: t.unpriced + (num(r.value) > 0 || num(r.consumed) === 0 ? 0 : 1) }), { value: 0, unpriced: 0 }), [consumption]);
  const topShare = useMemo(() => (consumed.value > 0 ? consumption.reduce((t, r) => Math.max(t, (num(r.value) / consumed.value) * 100), 0) : 0), [consumption, consumed]);
  const breached = num(totals?.batches) ? byGrade.reduce((t, g) => t + num(g.varianceBatches), 0) : 0;
  const reconOff = (recon?.rows ?? []).filter((r) => Math.abs(num(r.dosingVarianceQty)) > 1e-9 || Math.abs(num(r.stockVarianceQty)) > 1e-9).length;

  return (
    <div className="mn-ord mn-pr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Production reports</h1>
          <p>What the plant made and what it took: the batches and cubic metres by grade against the plan, every ticket day by day, the material each grade consumed and what it was worth, and where the recipe, the controller and the books disagree.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BarChart3 size={14} aria-hidden />
            {loaded ? `${qty(totals?.batches)} ${num(totals?.batches) === 1 ? 'batch' : 'batches'} · ${m3(totals?.producedM3)}` : 'Loading…'}
          </span>
          <Link href="/app/production/batch-tickets" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ClipboardList size={14} />}>Batch tickets</Button>
          </Link>
          <Link href="/app/production/stock" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Package size={14} />}>Stock</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {loaded && (variance.length > 0 || reconOff > 0) && (
        <div className="mn-ord-notes">
          {variance.length > 0 && (
            <a className="mn-ord-note mn-ord-note--warn" href="#breaches">
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{variance.length} confirmed {variance.length === 1 ? 'batch was' : 'batches were'} outside tolerance: {variance.slice(0, 4).map((v) => String(v.batchTicketNo)).join(', ')}{variance.length > 4 ? ` and ${variance.length - 4} more` : ''}.</strong>{' '}
                The materials that missed their target are listed at the bottom; check the gates and the moisture settings on the controller.
              </span>
            </a>
          )}
          {reconOff > 0 && (
            <a className="mn-ord-note mn-ord-note--warn" href="#reconciliation">
              <Scale size={16} aria-hidden />
              <span>
                <strong>{reconOff} {reconOff === 1 ? 'material does' : 'materials do'} not reconcile in this period.</strong>{' '}
                What the controller dosed differs from the recipe or from what left the books; see the reconciliation below.
              </span>
            </a>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Batches" value={loaded ? qty(totals?.batches) : '—'} tone="info" />
        <StatCard label="Produced" value={loaded ? m3(totals?.producedM3) : '—'} tone={num(totals?.producedM3) > 0 ? 'success' : 'neutral'} />
        <StatCard label="Grades" value={loaded ? String(grades.filter((g) => g.batches > 0).length) : '—'} />
        <StatCard label="Outside tolerance" value={loaded ? String(breached) : '—'} tone={breached ? 'warning' : 'neutral'} />
        <StatCard label="Material used" value={loaded ? moneyShort(consumed.value) : '—'} tone={consumed.value > 0 ? 'info' : 'neutral'} />
      </div>

      {/* Period bar: the quick windows as chips, or any two dates; bounds every report but the breach list. */}
      <div className="mn-dr-period" role="group" aria-label="Period for the reports">
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

      <Card
        title={<span className="mn-board-card-title"><BarChart3 size={16} aria-hidden /> By grade <span className="mn-board-card-count">{grades.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel}{pva?.totals && num(pva.totals.plannedM3) > 0 ? ` · planned ${m3(pva.totals.plannedM3)}` : ''}</span>
            <ExportButton rows={grades} columns={['label', 'batches', 'produced', 'planned', 'breached']} filename="production-by-grade" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : grades.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Grade</Th>
                  <Th numeric>Batches</Th>
                  <Th numeric>Produced</Th>
                  <Th numeric>Planned</Th>
                  <Th numeric>vs plan</Th>
                  <Th numeric>Outside tolerance</Th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => {
                  const diff = g.planned == null ? null : g.produced - g.planned;
                  return (
                    <tr key={g.label}>
                      <Td><span className="mn-od-num">{g.label}</span></Td>
                      <Td numeric>{qty(g.batches)}</Td>
                      <Td numeric><span className="mn-od-num">{m3(g.produced)}</span></Td>
                      <Td numeric>{g.planned == null || g.planned === 0 ? <span className="mn-ord-meta">not planned</span> : m3(g.planned)}</Td>
                      <Td numeric>{diff == null || g.planned === 0 ? '—' : <span className={diff < 0 ? 'mn-st-out' : diff > 0 ? 'mn-st-in' : undefined}>{signed(diff, ' m³')}{g.planned ? pct((diff / g.planned) * 100) : ''}</span>}</Td>
                      <Td numeric>{g.breached ? <span className="mn-ir-low">{g.breached}</span> : '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td>All grades · {periodLabel}</Td>
                  <Td numeric>{qty(totals?.batches)}</Td>
                  <Td numeric><span className="mn-ir-total-value">{m3(totals?.producedM3)}</span></Td>
                  <Td numeric>{pva?.totals && num(pva.totals.plannedM3) > 0 ? m3(pva.totals.plannedM3) : '—'}</Td>
                  <Td numeric>{pva?.totals && num(pva.totals.plannedM3) > 0 ? <span className={num(pva.totals.varianceM3) < 0 ? 'mn-st-out' : num(pva.totals.varianceM3) > 0 ? 'mn-st-in' : undefined}>{signed(pva.totals.varianceM3, ' m³')}{pct(pva.totals.variancePct)}</span> : '—'}</Td>
                  <Td numeric>{breached || '—'}</Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[0] ? <ErrorState message={String(failed[0])} /> : (
          <EmptyState title="No production in this period" description="Confirmed batch tickets count here by their batch date. Widen the period, or confirm the tickets waiting under Batch tickets." />
        )}
        <p className="mn-ir-foot">Produced is the total of confirmed batch tickets; planned is the total of production plans dated in the period{failed[4] ? ' (the plan report did not load)' : ''}. A batch is outside tolerance when any material missed its target by more than the mix design allows.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><ScrollText size={16} aria-hidden /> Batch register <span className="mn-board-card-count">{batch?.count ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel} · {m3(batch?.totalM3)}</span>
            <ExportButton rows={batch?.rows ?? []} columns={['date', 'batchTicketNo', 'gradeLabel', 'm3', 'orderNo', 'customerName', 'operatorName', 'varianceExceeded']} filename="batch-register" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : days.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Grade</Th>
                  <Th>Mixed for</Th>
                  <Th>Operator</Th>
                  <Th numeric>Quantity</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <Fragment key={day.date}>
                    <tr className="mn-dr-day">
                      <Td colSpan={4}><span className="mn-dr-day-label">{dayLabel(day.date)}</span><span className="mn-ord-meta"> · {day.rows.length} {day.rows.length === 1 ? 'batch' : 'batches'}</span></Td>
                      <Td numeric><span className="mn-dr-day-m3">{m3(day.m3)}</span></Td>
                    </tr>
                    {day.rows.map((r) => (
                      <tr key={String(r.id ?? r.batchTicketNo)}>
                        <Td>
                          <Link href={`/app/production/batch-tickets/${String(r.id)}`} className="mn-id-link mn-od-num">{String(r.batchTicketNo)}</Link>
                          <span className="mn-od-rate-meta">{r.batchedAt ? formatDateTime(r.batchedAt) : ''}{r.varianceExceeded ? ' · outside tolerance' : ''}</span>
                        </Td>
                        <Td><Badge tone="info">{String(r.gradeLabel ?? '—')}</Badge></Td>
                        <Td>
                          <span>{String(r.customerName ?? 'No order')}</span>
                          {r.orderNo ? <span className="mn-od-rate-meta">{String(r.orderNo)}</span> : null}
                        </Td>
                        <Td>{r.operatorName ? String(r.operatorName) : <span className="mn-ord-meta">—</span>}</Td>
                        <Td numeric><span className="mn-od-num">{m3(r.m3)}</span></Td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="mn-dr-total">
                  <Td colSpan={4}>{batch?.count ?? 0} {batch?.count === 1 ? 'batch' : 'batches'} · {periodLabel}</Td>
                  <Td numeric><span className="mn-dr-total-m3">{m3(batch?.totalM3)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[3] ? <ErrorState message={String(failed[3])} /> : (
          <EmptyState title="No batches in this period" description="Every confirmed batch ticket is listed here by the day it was batched. Widen the period, or open Batch tickets to see what is still in draft." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> Material consumption <span className="mn-board-card-count">{consumption.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel} · {money(consumed.value)} at standard rates</span>
            <ExportButton rows={consumption} columns={['material', 'materialCode', 'uom', 'consumed', 'value']} filename="material-consumption" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : consumption.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>Consumed</Th>
                  <Th numeric>Value</Th>
                  <Th numeric>Share of value</Th>
                </tr>
              </thead>
              <tbody>
                {consumption.map((c) => {
                  const share = consumed.value > 0 ? (num(c.value) / consumed.value) * 100 : 0;
                  return (
                    <tr key={String(c.material)}>
                      <Td>
                        <span className="mn-od-num">{String(c.material)}</span>
                        <span className="mn-od-rate-meta">{String(c.materialCode ?? '')}{c.uom ? ` · ${String(c.uom)}` : ''}</span>
                      </Td>
                      <Td numeric><span className="mn-st-out">−{qty(c.consumed)} {String(c.uom ?? '')}</span></Td>
                      <Td numeric>{num(c.value) > 0 ? <span className="mn-od-num">{money(c.value)}</span> : <span className="mn-ord-meta">no rate</span>}</Td>
                      <Td numeric>
                        {share > 0 ? `${share.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%` : '—'}
                        {share > 0 ? <span className="mn-od-linebar mn-pr-bar" aria-hidden><span style={{ width: `${Math.max(4, (share / topShare) * 100)}%` }} /></span> : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={2}>All materials · {periodLabel}</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(consumed.value)}</span></Td>
                  <Td numeric>100%</Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[2] ? <ErrorState message={String(failed[2])} /> : (
          <EmptyState title="Nothing consumed in this period" description="Material leaves the books when a batch ticket is confirmed. Widen the period, or confirm the tickets waiting under Batch tickets." />
        )}
        <p className="mn-ir-foot">Consumed is what left the stock ledger for batching (including issues approved below zero), valued at each material&apos;s standard rate{consumed.unpriced > 0 ? `; ${consumed.unpriced} ${consumed.unpriced === 1 ? 'material has' : 'materials have'} no standard rate and count as zero` : ''}. Set rates under Masters › Materials.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title" id="reconciliation"><Scale size={16} aria-hidden /> Material reconciliation <span className="mn-board-card-count">{recon?.rows.length ?? 0}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{reconOff ? `${reconOff} ${reconOff === 1 ? 'material does' : 'materials do'} not agree` : loaded && recon?.rows.length ? 'Recipe, controller and books agree' : periodLabel}</span>
            <ExportButton rows={recon?.rows ?? []} columns={['material', 'uom', 'theoretical', 'actualDosed', 'stockConsumed', 'dosingVarianceQty', 'dosingVariancePct', 'stockVarianceQty', 'stockVariancePct']} filename="material-reconciliation" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : recon?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>Recipe says</Th>
                  <Th numeric>Controller dosed</Th>
                  <Th numeric>Left the books</Th>
                  <Th numeric>Dosing gap</Th>
                  <Th numeric>Books gap</Th>
                </tr>
              </thead>
              <tbody>
                {recon.rows.map((r) => {
                  const doseVar = num(r.dosingVarianceQty);
                  const stockVar = num(r.stockVarianceQty);
                  const unit = String(r.uom ?? '');
                  return (
                    <tr key={String(r.material)}>
                      <Td><span className="mn-od-num">{String(r.material)}</span>{unit ? <span className="mn-od-rate-meta">{unit}</span> : null}</Td>
                      <Td numeric>{qty(r.theoretical)}</Td>
                      <Td numeric>{qty(r.actualDosed)}</Td>
                      <Td numeric>{qty(r.stockConsumed)}</Td>
                      <Td numeric><span className={Math.abs(doseVar) < 1e-9 ? undefined : 'mn-ir-low'}>{signed(doseVar)}{Math.abs(doseVar) < 1e-9 ? '' : pct(r.dosingVariancePct)}</span></Td>
                      <Td numeric><span className={Math.abs(stockVar) < 1e-9 ? undefined : 'mn-ir-low'}>{signed(stockVar)}{Math.abs(stockVar) < 1e-9 ? '' : pct(r.stockVariancePct)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td>All materials · {periodLabel}</Td>
                  <Td numeric>{qty(recon.totals.theoretical)}</Td>
                  <Td numeric>{qty(recon.totals.actualDosed)}</Td>
                  <Td numeric>{qty(recon.totals.stockConsumed)}</Td>
                  <Td numeric><span className={Math.abs(num(recon.totals.dosingVarianceQty)) < 1e-9 ? undefined : 'mn-ir-low'}>{signed(recon.totals.dosingVarianceQty)}</span></Td>
                  <Td numeric><span className={Math.abs(num(recon.totals.stockVarianceQty)) < 1e-9 ? undefined : 'mn-ir-low'}>{signed(recon.totals.stockVarianceQty)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[5] ? <ErrorState message={String(failed[5])} /> : (
          <EmptyState title="Nothing to reconcile in this period" description="Confirmed batches only: the mix design target, what the controller dosed, and what left the stock books." />
        )}
        <p className="mn-ir-foot">Three numbers per material, in the material&apos;s own unit. The dosing gap is the controller against the recipe: a steady gap means the gates over- or under-dose, or the moisture correction is off. The books gap is the ledger against the controller: material leaving the books that no batch dosed points to an untracked issue, spillage or a wrong opening balance.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title" id="breaches"><FlaskConical size={16} aria-hidden /> Outside tolerance <span className="mn-board-card-count">{variance.length}</span></span>}
        actions={<span className="mn-ord-how">Every confirmed batch, whatever the period</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : variance.length ? (
          <div className="mn-pr-breaches">
            {variance.map((v) => (
              <section key={String(v.id ?? v.batchTicketNo)} className="mn-pr-breach">
                <header className="mn-pr-breach-head">
                  <div>
                    <Link href={`/app/production/batch-tickets/${String(v.id)}`} className="mn-id-link mn-od-num">{String(v.batchTicketNo)}</Link>
                    <span className="mn-od-rate-meta">{v.batchedAt ? formatDateTime(v.batchedAt) : ''}</span>
                  </div>
                  <Badge tone="info">{String(v.gradeLabel ?? '—')}</Badge>
                  <span className="mn-ord-meta">{m3(v.batchQuantityM3)} · {((v.breaches as Row[]) ?? []).length} {((v.breaches as Row[]) ?? []).length === 1 ? 'material' : 'materials'} missed</span>
                </header>
                <div className="mn-id-scroll">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Material</Th>
                        <Th numeric>Target</Th>
                        <Th numeric>Actual</Th>
                        <Th numeric>Off by</Th>
                        <Th numeric>Allowed</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {((v.breaches as Row[]) ?? []).map((b, j) => (
                        <tr key={j}>
                          <Td><span className="mn-od-num">{String(b.material)}</span></Td>
                          <Td numeric>{qty(b.target)}</Td>
                          <Td numeric>{qty(b.actual)}</Td>
                          <Td numeric><span className="mn-ir-low">{num(b.variancePercentage) > 0 ? '+' : ''}{qty(b.variancePercentage)}%</span></Td>
                          <Td numeric>±{qty(b.tolerancePercentage)}%</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </section>
            ))}
          </div>
        ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
          <EmptyState title="Every batch within tolerance" description="A batch is listed here when a material was dosed further from its target than the mix design allows and the ticket was confirmed anyway." />
        )}
      </Card>
    </div>
  );
}
