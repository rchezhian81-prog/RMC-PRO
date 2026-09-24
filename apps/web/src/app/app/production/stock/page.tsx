'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownToLine, BookOpen, CheckCircle2, History, Package, PackageMinus, RefreshCw, Scale } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, stockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Stock — what is in the yard and the silos right now.
 *
 * A health strip (negative / below reorder / healthy) with live counts
 * doubles as the filter, a summary pill totals the stock value on screen,
 * five tiles sum the position up, and each material is one row: what is on
 * hand against its reorder level, how many days that covers at the last 30
 * days' batching, what it is worth at the standard rate, the last movement,
 * and its health. Notes name what is negative and what needs ordering. The
 * opening-balance form (a bootstrap; day to day, stock comes in through
 * Material inward) sits above the list; the movement ledger sits below it
 * and can be narrowed to one material from its row. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'negative', label: 'Negative', tone: 'danger', hint: 'Below zero: more was batched than was booked in. Book the inward that arrived, or adjust to what the yard holds' },
  { key: 'low', label: 'Below reorder', tone: 'warning', hint: 'At or below the reorder level set on the material: order it' },
  { key: 'ok', label: 'Healthy', tone: 'success', hint: 'Above its reorder level' },
];
const toneOf = (stage: string): Tone => STAGES.find((s) => s.key === stage)?.tone ?? 'neutral';
const labelOf = (stage: string) => STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? stage;
function stageOf(b: Row): string {
  const q = num(b.currentQuantity);
  if (q < 0) return 'negative';
  if (num(b.reorderLevel) > 0 && q <= num(b.reorderLevel)) return 'low';
  return 'ok';
}
/** Days the balance lasts at the last 30 days' batching rate; null when nothing was batched. */
const coverDays = (b: Row) => (num(b.avgDailyOut) > 0 ? Math.max(0, num(b.currentQuantity)) / num(b.avgDailyOut) : null);
const valueOf = (b: Row) => Math.max(0, num(b.currentQuantity)) * num(b.standardRate);

const MOVES: Record<string, string> = {
  opening: 'Opening balance',
  batch_consumption: 'Batched',
  inward: 'Received',
  adjustment: 'Adjusted',
  negative_stock: 'Negative stock approved',
};
const moveLabel = (t: unknown) => MOVES[String(t ?? '')] ?? String(t ?? '').replace(/_/g, ' ');
/** Where a ledger line's reference lives, when it has a screen. */
function refLink(l: Row): { href: string; label: string } | null {
  const t = String(l.referenceType ?? '');
  const id = l.referenceId ? String(l.referenceId) : '';
  if (t === 'batch_ticket' && id) return { href: `/app/production/batch-tickets/${id}`, label: 'Batch ticket' };
  if (t === 'material_inward') return { href: '/app/inventory/inward', label: 'Material inward' };
  if (t === 'stock_adjustment') return { href: '/app/inventory/adjustments', label: 'Stock adjustments' };
  if (t === 'negative_stock_request') return { href: '/app/inventory/negative-stock', label: 'Negative stock' };
  return null;
}

export default function StockPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [ledgerMaterial, setLedgerMaterial] = useState('');
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [b, l, m, p] = await Promise.all([
      stockApi.balances(),
      stockApi.ledger(ledgerMaterial || undefined, win.limit),
      crud('materials').list(),
      crud('plants').list(),
    ]);
    setBalances(b);
    setLedger(l);
    setMaterials(m);
    setPlants(p);
    // One plant is the common case: pick it so the form is two fields.
    setForm((f) => (f.plantId || p.length !== 1 ? f : { ...f, plantId: String(p[0]?.id ?? '') }));
  }, [ledgerMaterial, win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function setOpening(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const m = materials.find((x) => String(x.id) === form.materialId);
      await stockApi.setOpening({ plantId: form.plantId || undefined, materialId: form.materialId, quantity: num(form.quantity) });
      setForm((f) => ({ ...f, materialId: '', quantity: '' }));
      await reload();
      setMsg(`${String(m?.materialName ?? 'Material')} set to ${qty(form.quantity)} ${String(m?.uom ?? '')}. Over an existing balance this is booked as an adjustment.`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function showMovements(materialId: string) {
    setLedgerMaterial(materialId);
    window.setTimeout(() => document.getElementById('movements')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const shown = filter ? balances.filter((b) => stageOf(b) === filter) : balances;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) m.set(stageOf(b), (m.get(stageOf(b)) ?? 0) + 1);
    return m;
  }, [balances]);
  const totalValue = useMemo(() => shown.reduce((t, b) => t + valueOf(b), 0), [shown]);
  const allValue = useMemo(() => balances.reduce((t, b) => t + valueOf(b), 0), [balances]);
  const consumedValue = useMemo(() => balances.reduce((t, b) => t + num(b.consumed30) * num(b.standardRate), 0), [balances]);
  const negative = useMemo(() => balances.filter((b) => stageOf(b) === 'negative'), [balances]);
  const low = useMemo(() => balances.filter((b) => stageOf(b) === 'low'), [balances]);
  const multiPlant = plants.length > 1;
  const chosen = materials.find((x) => String(x.id) === form.materialId);
  const ledgerLabel = ledgerMaterial ? String(balances.find((b) => String(b.materialId) === ledgerMaterial)?.materialLabel ?? materials.find((m) => String(m.id) === ledgerMaterial)?.materialName ?? 'one material') : '';

  return (
    <div className="mn-ord mn-st">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Stock</h1>
          <p>What is in the yard and the silos right now, how fast it goes, and what needs ordering. Batching draws it down; Material inward tops it up; an adjustment corrects it to what the yard actually holds.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Package size={14} aria-hidden />
            {shown.length} {filter ? labelOf(filter) : ''} {shown.length === 1 ? 'material' : 'materials'}
            {' · '}
            {moneyShort(totalValue)} on hand
          </span>
          <Link href="/app/inventory/inward" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<ArrowDownToLine size={14} />}>Material inward</Button>
          </Link>
          <Link href="/app/inventory/reports" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<BookOpen size={14} />}>Stock reports</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Health strip — counts per state; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stock health">
        {STAGES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`}
              data-tone={s.tone}
              aria-pressed={on}
              title={s.hint}
              onClick={() => setFilter(on ? '' : s.key)}
            >
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>
            Show all
          </button>
        )}
      </div>

      {(negative.length > 0 || low.length > 0) && !filter && (
        <div className="mn-ord-notes">
          {negative.length > 0 && (
            <div className="mn-ord-note mn-ord-note--bad" role="status">
              <PackageMinus size={16} aria-hidden />
              <span>
                <strong>{negative.length} {negative.length === 1 ? 'material is' : 'materials are'} below zero: {negative.map((b) => String(b.materialLabel)).join(', ')}.</strong>{' '}
                The plant batched more than was booked in. Book the delivery under <Link href="/app/inventory/inward">Material inward</Link>, or correct the balance under <Link href="/app/inventory/adjustments">Stock adjustments</Link>.
              </span>
            </div>
          )}
          {low.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span>
                <strong>{low.length} {low.length === 1 ? 'material is' : 'materials are'} at or below reorder level: {low.map((b) => String(b.materialLabel)).join(', ')}.</strong>{' '}
                Raise the <Link href="/app/purchase/orders">purchase order</Link> now; the days of cover on each row say how long it lasts.
              </span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Stock value" value={moneyShort(allValue)} tone="info" />
        <StatCard label="Materials" value={String(balances.length)} />
        <StatCard label="Below reorder" value={String(low.length)} tone={low.length ? 'warning' : 'neutral'} />
        <StatCard label="Negative" value={String(negative.length)} tone={negative.length ? 'danger' : 'neutral'} />
        <StatCard label="Batched, 30 days" value={moneyShort(consumedValue)} />
      </div>

      <Card title={<span className="mn-board-card-title"><Scale size={16} aria-hidden /> Set opening balance</span>}>
        <Form onSubmit={setOpening} className="mn-st-form">
          {multiPlant && (
            <Field label="Plant">
              <Select value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                <option value="">Pick the plant</option>
                {plants.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Material" required>
            <Select value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} required>
              <option value="">Pick a material</option>
              {materials.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label={chosen ? `Quantity on hand (${String(chosen.uom ?? '')})` : 'Quantity on hand'} required>
            <Input type="number" step="any" inputMode="decimal" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required placeholder="What the yard holds" />
          </Field>
          <div className="mn-st-form-submit">
            <Button type="submit" icon={<Scale size={14} />} loading={busy} disabled={!form.materialId}>Set opening</Button>
          </div>
        </Form>
        <p className="mn-board-form-hint">For the first stock count only. From then on, every delivery is booked under Material inward and every correction under Stock adjustments, so the ledger explains each change; setting an opening over an existing balance is booked as an adjustment.</p>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> On hand <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<ExportButton rows={shown} columns={['materialLabel', 'materialCode', 'plantName', 'currentQuantity', 'uom', 'reorderLevel', 'avgDailyOut', 'standardRate', 'lastMovementAt', 'lastMovementType']} filename="stock-balances" />}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : shown.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Material</span>
              <span className="is-num">On hand</span>
              <span>Cover</span>
              <span className="is-num">Value</span>
              <span>Last movement</span>
              <span>Health</span>
              <span />
            </div>
            {shown.map((b) => {
              const stage = stageOf(b);
              const q = num(b.currentQuantity);
              const days = coverDays(b);
              const reorder = num(b.reorderLevel);
              return (
                <div key={String(b.id)} className="mn-ord-row mn-ord-row--acts mn-st-row" data-tone={toneOf(stage)}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(b.materialLabel ?? '')}</span>
                    <span className="mn-ord-meta">{String(b.materialCode ?? '')}{multiPlant && b.plantName ? ` · ${String(b.plantName)}` : ''}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt${q < 0 ? ' mn-id-bad' : ''}`}>{qty(q)} {String(b.uom ?? '')}</span>
                    <span className="mn-ord-meta">{reorder > 0 ? `reorder at ${qty(reorder)}` : 'no reorder level set'}</span>
                  </div>
                  <div className="mn-st-cover">
                    {days == null ? (
                      <>
                        <span className="mn-ord-cust">Not batched lately</span>
                        <span className="mn-ord-meta">nothing drawn in 30 days</span>
                      </>
                    ) : (
                      <>
                        <span className={`mn-ord-cust${days < 7 ? ' mn-st-cover--short' : ''}`}>{days >= 365 ? 'Over a year' : `~${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`}</span>
                        <span className="mn-ord-meta">at {qty(b.avgDailyOut)} {String(b.uom ?? '')}/day</span>
                      </>
                    )}
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{num(b.standardRate) > 0 ? money(valueOf(b)) : '—'}</span>
                    <span className="mn-ord-meta">{num(b.standardRate) > 0 ? `${money(b.standardRate)}/${String(b.uom ?? 'unit')}` : 'no standard rate'}</span>
                  </div>
                  <div className="mn-ord-when">
                    <span className="mn-ord-when-d">{b.lastMovementAt ? formatDateTime(b.lastMovementAt) : '—'}</span>
                    <span className="mn-ord-when-m">{b.lastMovementType ? moveLabel(b.lastMovementType) : 'no movements'}</span>
                  </div>
                  <div className="mn-ord-status"><Badge tone={toneOf(stage)}>{STAGES.find((s) => s.key === stage)?.label ?? stage}</Badge></div>
                  <div className="mn-ord-act mn-st-acts">
                    <Button variant="ghost" size="sm" icon={<History size={14} />} onClick={() => showMovements(String(b.materialId))}>Movements</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : filter ? (
          <EmptyState title={`No ${labelOf(filter)} materials`} description="Press the chip again to show every material." />
        ) : (
          <EmptyState title="No stock yet" description="Set an opening balance for each material above, or book the first delivery under Material inward." />
        )}
      </Card>

      <div id="movements" className="mn-st-anchor" />
      <Card
        title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Movements <span className="mn-board-card-count">{ledger.length}</span></span>}
        actions={
          <div className="mn-st-ledger-tools">
            {ledgerMaterial ? (
              <button type="button" className="mn-board-chip is-on mn-st-chip" onClick={() => setLedgerMaterial('')} title="Show every material">
                <span className="mn-board-chip-l">{ledgerLabel} · show all</span>
              </button>
            ) : (
              <span className="mn-ord-how">Every material, newest first. Press Movements on a row to narrow it.</span>
            )}
            <ExportButton rows={ledger} columns={['createdAt', 'materialLabel', 'transactionType', 'referenceType', 'inQuantity', 'outQuantity', 'balanceAfter', 'remarks']} filename="stock-ledger" />
          </div>
        }
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : ledger.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Material</Th>
                  <Th>Movement</Th>
                  <Th numeric>In</Th>
                  <Th numeric>Out</Th>
                  <Th numeric>Balance after</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => {
                  const ref = refLink(l);
                  const inQ = num(l.inQuantity);
                  const outQ = num(l.outQuantity);
                  return (
                    <tr key={String(l.id)}>
                      <Td><span className="mn-od-num">{formatDateTime(l.createdAt)}</span></Td>
                      <Td>{String(l.materialLabel ?? '')}</Td>
                      <Td>
                        <span>{moveLabel(l.transactionType)}</span>
                        <span className="mn-od-rate-meta">
                          {ref ? <Link href={ref.href} className="mn-id-link">{ref.label}</Link> : null}
                          {ref && l.remarks ? ' · ' : ''}
                          {l.remarks ? String(l.remarks) : ''}
                        </span>
                      </Td>
                      <Td numeric>{inQ > 0 ? <span className="mn-st-in">+{qty(inQ)}</span> : '—'}</Td>
                      <Td numeric>{outQ > 0 ? <span className="mn-st-out">−{qty(outQ)}</span> : '—'}</Td>
                      <Td numeric><span className={`mn-od-num${num(l.balanceAfter) < 0 ? ' mn-id-bad' : ''}`}>{qty(l.balanceAfter)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title={ledgerMaterial ? 'No movements for this material' : 'No movements yet'} description={ledgerMaterial ? 'Nothing has been booked in, batched or adjusted for it.' : 'Opening balances, deliveries, batching and adjustments appear here as they happen.'} />
        )}
        <ListCap shown={ledger.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="movements" hint="the stock movement report (Inventory → Reports)" />
      </Card>
    </div>
  );
}
