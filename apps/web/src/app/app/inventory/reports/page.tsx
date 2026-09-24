'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownToLine, BookOpen, CalendarRange, Package, PackageMinus, RefreshCw } from 'lucide-react';
import { currentMonthRange, settledFailure, settledReason, settledValue, todayLocal } from '../../../../lib/report-range';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { inventoryReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Inventory reports — the stock position and how it moved.
 *
 * Five tiles sum the position up (stock value, materials, below reorder,
 * negative, and the value received in the period); notes name what is
 * negative and what needs ordering; a period bar (today / this week / this
 * month / last month / all time, or any two dates) bounds the movement
 * report, which reads as a story per material (received, opening,
 * adjusted, batched, issued below zero) with the net; then the valuation at
 * the standard rate with its total. Each card checks its own settled slot
 * first, so a refused report says so instead of "No …". Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const signed = (v: unknown) => (num(v) === 0 ? '—' : `${num(v) > 0 ? '+' : '−'}${qty(Math.abs(num(v)))}`);

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

export default function InventoryReportsPage() {
  const [low, setLow] = useState<Row[]>([]);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [negative, setNegative] = useState<Row[]>([]);
  const [valuation, setValuation] = useState<{ rows: Row[]; total: number } | null>(null);
  const [movement, setMovement] = useState<Row[]>([]);
  // Bounds the movement report; the stock views are point-in-time.
  const [range, setRange] = useState<Range>(currentMonthRange());
  const [draft, setDraft] = useState<Range>(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setBusy(true);
    try {
      // allSettled: low stock, negative stock, valuation and the movement
      // report are independent; one failing must not blank the other three.
      const out = await Promise.allSettled([
        inventoryReportsApi.lowStock(),
        inventoryReportsApi.negativeStock(),
        inventoryReportsApi.valuation(),
        inventoryReportsApi.movement(r.from || undefined, r.to || undefined),
      ]);
      setLow(settledValue(out[0]) ?? []);
      setNegative(settledValue(out[1]) ?? []);
      setValuation(settledValue(out[2]));
      setMovement(settledValue(out[3]) ?? []);
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

  const rateOf = useMemo(() => new Map((valuation?.rows ?? []).map((r) => [String(r.material), num(r.standardRate)])), [valuation]);
  const receivedValue = useMemo(() => movement.reduce((t, r) => t + num(r.received) * (rateOf.get(String(r.material)) ?? 0), 0), [movement, rateOf]);
  const batchedValue = useMemo(() => movement.reduce((t, r) => t + num(r.batched) * (rateOf.get(String(r.material)) ?? 0), 0), [movement, rateOf]);
  const totals = useMemo(() => movement.reduce((t, r) => ({ in: t.in + num(r.totalIn), out: t.out + num(r.totalOut), moves: t.moves + num(r.movements) }), { in: 0, out: 0, moves: 0 }), [movement]);

  return (
    <div className="mn-ord mn-ir">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Inventory reports</h1>
          <p>Where the stock stands and how it moved: what needs ordering, what is below zero, what the yard is worth at standard rates, and, for any period, what came in and what went out of each material and why.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <BookOpen size={14} aria-hidden />
            {valuation ? `${valuation.rows.length} ${valuation.rows.length === 1 ? 'material' : 'materials'} · ${moneyShort(valuation.total)}` : 'Loading…'}
          </span>
          <Link href="/app/production/stock" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Package size={14} />}>Stock</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {(negative.length > 0 || low.length > 0) && (
        <div className="mn-ord-notes">
          {negative.length > 0 && (
            <Link className="mn-ord-note mn-ord-note--bad" href="/app/inventory/negative-stock">
              <PackageMinus size={16} aria-hidden />
              <span>
                <strong>{negative.length} {negative.length === 1 ? 'material is' : 'materials are'} below zero: {negative.map((r) => `${String(r.materialLabel)} (${qty(r.currentQuantity)} ${String(r.uom ?? '')})`).join(', ')}.</strong>{' '}
                Book the deliveries that arrived, or correct the balance under Stock adjustments.
              </span>
            </Link>
          )}
          {low.length > 0 && (
            <Link className="mn-ord-note mn-ord-note--warn" href="/app/purchase/orders">
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{low.length} {low.length === 1 ? 'material is' : 'materials are'} at or below reorder level: {low.map((r) => `${String(r.material)} (${qty(r.currentQuantity)} of ${qty(r.reorderLevel)} ${String(r.uom ?? '')})`).join(', ')}.</strong>{' '}
                Raise the purchase orders now.
              </span>
            </Link>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Stock value" value={valuation ? moneyShort(valuation.total) : '—'} tone="info" />
        <StatCard label="Materials" value={valuation ? String(valuation.rows.length) : '—'} />
        <StatCard label="Below reorder" value={loaded ? String(low.length) : '—'} tone={low.length ? 'warning' : 'neutral'} />
        <StatCard label="Negative" value={loaded ? String(negative.length) : '—'} tone={negative.length ? 'danger' : 'neutral'} />
        <StatCard label="Received in period" value={loaded ? moneyShort(receivedValue) : '—'} tone={receivedValue > 0 ? 'success' : 'neutral'} />
      </div>

      {/* Period bar: the quick windows as chips, or any two dates; bounds the movement report only. */}
      <div className="mn-dr-period" role="group" aria-label="Period for the movement report">
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
        title={<span className="mn-board-card-title"><ArrowDownToLine size={16} aria-hidden /> Movement <span className="mn-board-card-count">{movement.length}</span></span>}
        actions={
          <div className="mn-ir-tools">
            <span className="mn-ord-how">{periodLabel} · {totals.moves} {totals.moves === 1 ? 'movement' : 'movements'}</span>
            <ExportButton rows={movement} columns={['material', 'materialCode', 'uom', 'received', 'opening', 'adjustedUp', 'batched', 'adjustedDown', 'negativeIssued', 'totalIn', 'totalOut']} filename="stock-movement" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : movement.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>Received</Th>
                  <Th numeric>Batched</Th>
                  <Th numeric>Adjusted</Th>
                  <Th numeric>Total in</Th>
                  <Th numeric>Total out</Th>
                  <Th numeric>Net</Th>
                </tr>
              </thead>
              <tbody>
                {movement.map((r) => {
                  const adjusted = num(r.adjustedUp) - num(r.adjustedDown);
                  const net = num(r.totalIn) - num(r.totalOut);
                  const unit = String(r.uom ?? '');
                  return (
                    <tr key={String(r.material)}>
                      <Td>
                        <span className="mn-od-num">{String(r.material)}</span>
                        <span className="mn-od-rate-meta">{String(r.materialCode ?? '')}{unit ? ` · ${unit}` : ''}{num(r.opening) > 0 ? ` · opening ${qty(r.opening)}` : ''}{num(r.negativeIssued) > 0 ? ` · ${qty(r.negativeIssued)} issued below zero` : ''}</span>
                      </Td>
                      <Td numeric>{num(r.received) > 0 ? <span className="mn-st-in">+{qty(r.received)}</span> : '—'}</Td>
                      <Td numeric>{num(r.batched) > 0 ? <span className="mn-st-out">−{qty(r.batched)}</span> : '—'}</Td>
                      <Td numeric><span className={adjusted > 0 ? 'mn-st-in' : adjusted < 0 ? 'mn-st-out' : undefined}>{signed(adjusted)}</span></Td>
                      <Td numeric>{qty(r.totalIn)}</Td>
                      <Td numeric>{qty(r.totalOut)}</Td>
                      <Td numeric><span className={`mn-od-num${net < 0 ? ' mn-id-bad' : ''}`}>{signed(net)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={4}>All materials · {periodLabel}</Td>
                  <Td numeric>{qty(totals.in)}</Td>
                  <Td numeric>{qty(totals.out)}</Td>
                  <Td numeric><span className={`mn-od-num${totals.in - totals.out < 0 ? ' mn-id-bad' : ''}`}>{signed(totals.in - totals.out)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[3] ? <ErrorState message={String(failed[3])} /> : (
          <EmptyState title="No movement in this period" description="Deliveries, batching, opening balances and adjustments appear here by material. Widen the period, or check the ledger under Stock." />
        )}
        <p className="mn-ir-foot">Received is what came in through Material inward; batched is what the plant consumed; adjusted is the net of corrections. Units and quantities are the material&apos;s own; the value received in the period is {money(receivedValue)} and the value batched {money(batchedValue)}, both at standard rates.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> Stock valuation <span className="mn-board-card-count">{valuation?.rows.length ?? 0}</span></span>}
        actions={<ExportButton rows={valuation?.rows ?? []} columns={['material', 'materialCode', 'currentQuantity', 'uom', 'standardRate', 'value']} filename="stock-valuation" />}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : valuation?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>On hand</Th>
                  <Th numeric>Standard rate</Th>
                  <Th numeric>Value</Th>
                </tr>
              </thead>
              <tbody>
                {valuation.rows.map((r) => (
                  <tr key={String(r.material)}>
                    <Td>
                      <span className="mn-od-num">{String(r.material)}</span>
                      <span className="mn-od-rate-meta">{String(r.materialCode ?? '')}</span>
                    </Td>
                    <Td numeric><span className={num(r.currentQuantity) < 0 ? 'mn-id-bad' : undefined}>{qty(r.currentQuantity)} {String(r.uom ?? '')}</span></Td>
                    <Td numeric>{num(r.standardRate) > 0 ? `${money(r.standardRate)}/${String(r.uom ?? 'unit')}` : <span className="mn-ord-meta">no rate</span>}</Td>
                    <Td numeric><span className="mn-od-num">{num(r.standardRate) > 0 ? money(r.value) : '—'}</span></Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="mn-ir-total">
                  <Td colSpan={3}>Stock value at standard rates</Td>
                  <Td numeric><span className="mn-ir-total-value">{money(valuation.total)}</span></Td>
                </tr>
              </tfoot>
            </Table>
          </div>
        ) : failed[2] ? <ErrorState message={String(failed[2])} /> : (
          <EmptyState title="No stock" description="Set opening balances under Stock, or book the first delivery under Material inward." />
        )}
      </Card>

      <div className="mn-ir-two">
        <Card title={<span className="mn-board-card-title"><AlertTriangle size={16} aria-hidden /> Below reorder level <span className="mn-board-card-count">{low.length}</span></span>} padded={false}>
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : low.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>On hand</Th>
                  <Th numeric>Reorder at</Th>
                </tr>
              </thead>
              <tbody>
                {low.map((r) => (
                  <tr key={String(r.material)}>
                    <Td><span className="mn-od-num">{String(r.material)}</span><span className="mn-od-rate-meta">{String(r.materialCode ?? '')}</span></Td>
                    <Td numeric><span className="mn-ir-low">{qty(r.currentQuantity)} {String(r.uom ?? '')}</span></Td>
                    <Td numeric>{qty(r.reorderLevel)} {String(r.uom ?? '')}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : failed[0] ? <ErrorState message={String(failed[0])} /> : (
            <EmptyState title="Nothing to reorder" description="Every material with a reorder level is above it." />
          )}
        </Card>

        <Card title={<span className="mn-board-card-title"><PackageMinus size={16} aria-hidden /> Below zero <span className="mn-board-card-count">{negative.length}</span></span>} padded={false}>
          {!loaded ? (
            <TableSkeleton cols={2} />
          ) : negative.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>On hand</Th>
                </tr>
              </thead>
              <tbody>
                {negative.map((r) => (
                  <tr key={String(r.id)}>
                    <Td><span className="mn-od-num">{String(r.materialLabel ?? '')}</span></Td>
                    <Td numeric><span className="mn-id-bad mn-od-num">{qty(r.currentQuantity)} {String(r.uom ?? '')}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : failed[1] ? <ErrorState message={String(failed[1])} /> : (
            <EmptyState title="Nothing below zero" description="No material has been batched or issued beyond what the books hold." />
          )}
        </Card>
      </div>
    </div>
  );
}
