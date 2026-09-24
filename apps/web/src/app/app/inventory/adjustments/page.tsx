'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, History, Package, PackageMinus, RefreshCw, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, negativeStockApi, stockAdjustApi, stockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Stock adjustments — correcting stock to what the yard actually holds.
 *
 * The adjustment form comes first: pick the material and see what is on
 * hand, choose up or down, enter the quantity and the reason, and read the
 * balance it leaves before applying it; a decrease that would go below zero
 * says so and becomes an approval request instead. A note flags requests
 * waiting for approval. Below it, every material with what it holds and an
 * Adjust shortcut, then the adjustments applied, newest first, with the
 * change, the balance it left and the reason. Same layout in both skins;
 * every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
function healthOf(b: Row): { label: string; tone: Tone } {
  const q = num(b.currentQuantity);
  if (q < 0) return { label: 'Negative', tone: 'danger' };
  if (num(b.reorderLevel) > 0 && q <= num(b.reorderLevel)) return { label: 'Below reorder', tone: 'warning' };
  return { label: 'Healthy', tone: 'success' };
}
/** The ledger's reason for an adjustment line, in plain words. */
const reasonOf = (r: Row) => (String(r.referenceType ?? '') === 'opening' ? `Opening balance reset${r.remarks ? ` (${String(r.remarks).replace(/^Opening balance reset\s*/i, '')})` : ''}` : r.remarks ? String(r.remarks) : 'No reason recorded');

export default function StockAdjustmentsPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [pending, setPending] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', materialId: '', direction: 'increase', quantity: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [b, h, m, p, n] = await Promise.all([
      stockApi.balances(),
      stockAdjustApi.list(win.limit),
      crud('materials').list(),
      crud('plants').list(),
      negativeStockApi.list('pending').catch(() => [] as Row[]),
    ]);
    setBalances(b);
    setHistory(h);
    setMaterials(m);
    setPlants(p);
    setPending(n);
    setForm((f) => (f.plantId || p.length !== 1 ? f : { ...f, plantId: String(p[0]?.id ?? '') }));
  }, [win.limit]);

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

  const multiPlant = plants.length > 1;
  const chosenMaterial = materials.find((x) => String(x.id) === form.materialId);
  const chosenBalance = balances.find((b) => String(b.materialId) === form.materialId && (!form.plantId || String(b.plantId) === form.plantId));
  const onHand = num(chosenBalance?.currentQuantity);
  const unit = String(chosenBalance?.uom ?? chosenMaterial?.uom ?? '');
  const delta = (form.direction === 'decrease' ? -1 : 1) * Math.abs(num(form.quantity));
  const after = onHand + delta;
  const goesNegative = delta < 0 && after < 0;

  function pick(materialId: string) {
    setForm((f) => ({ ...f, materialId }));
    setMsg(null);
    setError(null);
    window.setTimeout(() => document.getElementById('adjust-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function adjust(e: FormEvent) {
    e.preventDefault();
    if (!form.materialId) { setError('Pick the material to adjust.'); return; }
    if (!(Math.abs(num(form.quantity)) > 0)) { setError('Enter the quantity to adjust by.'); return; }
    if (!form.reason.trim()) { setError('Say why: the reason is what the ledger keeps.'); return; }
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await stockAdjustApi.adjust({
        plantId: form.plantId || undefined,
        materialId: form.materialId,
        quantity: Math.abs(num(form.quantity)),
        direction: form.direction,
        reason: form.reason.trim(),
      });
      const label = String(chosenMaterial?.materialName ?? 'Material');
      if (res.pendingApproval) {
        const req = res.request as Row;
        setMsg(`${label}: taking ${qty(req.requiredQuantity)} ${unit} out of ${qty(req.availableQuantity)} ${unit} would go below zero, so it was raised as a negative-stock request. Stock is unchanged until someone approves it under Negative stock.`);
      } else {
        setMsg(`${label} ${delta > 0 ? 'increased' : 'decreased'} by ${qty(Math.abs(delta))} ${unit}; now ${qty(res.balanceAfter)} ${unit} on hand.`);
      }
      setForm((f) => ({ ...f, materialId: '', quantity: '', reason: '', direction: 'increase' }));
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const upCount = useMemo(() => history.filter((r) => num(r.inQuantity) > 0).length, [history]);
  const downCount = useMemo(() => history.filter((r) => num(r.outQuantity) > 0).length, [history]);

  return (
    <div className="mn-ord mn-sa">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Stock adjustments</h1>
          <p>Correct stock to what the yard actually holds: a physical count, spillage, a torn bag, a delivery booked wrong. Every adjustment carries a reason into the ledger; a decrease that would take stock below zero waits for approval instead.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <SlidersHorizontal size={14} aria-hidden />
            {history.length} {history.length === 1 ? 'adjustment' : 'adjustments'}
            {history.length ? ` · ${upCount} up · ${downCount} down` : ''}
          </span>
          <Link href="/app/production/stock" className="mn-ord-link">
            <Button variant="secondary" size="sm" icon={<Package size={14} />}>Stock</Button>
          </Link>
          <Link href="/app/inventory/negative-stock" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<PackageMinus size={14} />}>Negative stock</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {pending.length > 0 && (
        <div className="mn-ord-notes">
          <Link href="/app/inventory/negative-stock" className="mn-ord-note mn-ord-note--warn">
            <ClipboardCheck size={16} aria-hidden />
            <span>
              <strong>{pending.length} {pending.length === 1 ? 'decrease is' : 'decreases are'} waiting for approval: {pending.map((r) => `${String(r.materialLabel ?? 'material')} −${qty(r.requiredQuantity)}`).join(', ')}.</strong>{' '}
              Each would take stock below zero; stock stays as it is until an approver decides under Negative stock.
            </span>
          </Link>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      <div id="adjust-form" className="mn-st-anchor" />
      <Card title={<span className="mn-board-card-title"><SlidersHorizontal size={16} aria-hidden /> New adjustment</span>}>
        <Form onSubmit={adjust} className="mn-sa-form">
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
          <Field label="Material" required help={chosenMaterial ? `${qty(onHand)} ${unit} on hand now` : undefined}>
            <Select value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} required>
              <option value="">Pick the material</option>
              {materials.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Direction">
            <div className="mn-sa-dir" role="group" aria-label="Direction">
              <button type="button" className={`mn-board-chip${form.direction === 'increase' ? ' is-on' : ''}`} data-tone="success" aria-pressed={form.direction === 'increase'} onClick={() => setForm({ ...form, direction: 'increase' })}>
                <TrendingUp size={14} aria-hidden /><span className="mn-board-chip-l">More than booked</span>
              </button>
              <button type="button" className={`mn-board-chip${form.direction === 'decrease' ? ' is-on' : ''}`} data-tone="danger" aria-pressed={form.direction === 'decrease'} onClick={() => setForm({ ...form, direction: 'decrease' })}>
                <TrendingDown size={14} aria-hidden /><span className="mn-board-chip-l">Less than booked</span>
              </button>
            </div>
          </Field>
          <Field label={unit ? `Quantity (${unit})` : 'Quantity'} required>
            <Input type="number" step="any" inputMode="decimal" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required placeholder="Amount" />
          </Field>
          <Field label="Reason" required>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required placeholder="Physical count on 24 Sep, spillage at the silo, torn bags…" />
          </Field>
          <div className="mn-sa-form-submit">
            <Button type="submit" icon={<CheckCircle2 size={14} />} loading={busy} disabled={!form.materialId}>{goesNegative ? 'Request approval' : 'Apply adjustment'}</Button>
            <span className={`mn-sa-preview${goesNegative ? ' mn-sa-preview--neg' : ''}`} aria-live="polite">
              {chosenMaterial && Math.abs(delta) > 0 ? (
                goesNegative
                  ? <><strong>{qty(onHand)} → {qty(after)} {unit}</strong><span className="mn-ord-meta">below zero, so this becomes an approval request; stock stays at {qty(onHand)} {unit} until it is approved</span></>
                  : <><strong>{qty(onHand)} → {qty(after)} {unit}</strong><span className="mn-ord-meta">applied straight away and written to the ledger with the reason</span></>
              ) : (
                <span className="mn-ord-meta">Pick the material and the quantity to see the balance it leaves.</span>
              )}
            </span>
          </div>
        </Form>
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> On hand <span className="mn-board-card-count">{balances.length}</span></span>}
        actions={<span className="mn-ord-how">Press Adjust on a row to start from that material.</span>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : balances.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th numeric>On hand</Th>
                  <Th>Health</Th>
                  <Th>Last movement</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => {
                  const h = healthOf(b);
                  const q = num(b.currentQuantity);
                  return (
                    <tr key={String(b.id)} className={String(b.materialId) === form.materialId ? 'mn-sa-picked' : undefined}>
                      <Td>
                        <span className="mn-od-num">{String(b.materialLabel ?? '')}</span>
                        <span className="mn-od-rate-meta">{String(b.materialCode ?? '')}{multiPlant && b.plantName ? ` · ${String(b.plantName)}` : ''}</span>
                      </Td>
                      <Td numeric>
                        <span className={`mn-od-num${q < 0 ? ' mn-id-bad' : ''}`}>{qty(q)} {String(b.uom ?? '')}</span>
                        {num(b.reorderLevel) > 0 ? <span className="mn-od-rate-meta">reorder at {qty(b.reorderLevel)}</span> : null}
                      </Td>
                      <Td><Badge tone={h.tone}>{h.label}</Badge></Td>
                      <Td>
                        <span>{b.lastMovementAt ? formatDateTime(b.lastMovementAt) : '—'}</span>
                        {b.lastMovementType ? <span className="mn-od-rate-meta">{String(b.lastMovementType).replace(/_/g, ' ')}</span> : null}
                      </Td>
                      <Td><Button variant="ghost" size="sm" icon={<SlidersHorizontal size={14} />} onClick={() => pick(String(b.materialId))}>Adjust</Button></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No stock yet" description="Set opening balances under Stock, or book the first delivery under Material inward." />
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Adjustments applied <span className="mn-board-card-count">{history.length}</span></span>}
        actions={<ExportButton rows={history} columns={['createdAt', 'materialLabel', 'inQuantity', 'outQuantity', 'balanceAfter', 'remarks']} filename="stock-adjustments" />}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : history.length ? (
          <div className="mn-ord-list">
            <div className="mn-ord-cols mn-sa-cols" aria-hidden>
              <span>When</span>
              <span>Material</span>
              <span className="is-num">Change</span>
              <span className="is-num">Balance after</span>
              <span>Reason</span>
            </div>
            {history.map((r) => {
              const up = num(r.inQuantity) > 0;
              const change = up ? num(r.inQuantity) : num(r.outQuantity);
              return (
                <div key={String(r.id)} className="mn-ord-row mn-sa-row" data-tone={up ? 'success' : 'danger'}>
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{formatDateTime(r.createdAt)}</span>
                    <span className="mn-ord-meta">{String(r.referenceType ?? '') === 'opening' ? 'from Stock' : 'from this screen'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.materialLabel ?? '')}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt ${up ? 'mn-st-in' : 'mn-st-out'}`}>{up ? '+' : '−'}{qty(change)}</span>
                    <span className="mn-ord-meta">{up ? 'more than booked' : 'less than booked'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt${num(r.balanceAfter) < 0 ? ' mn-id-bad' : ''}`}>{qty(r.balanceAfter)}</span>
                    <span className="mn-ord-meta">on hand after</span>
                  </div>
                  <div className="mn-sa-reason">{reasonOf(r)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No adjustments yet" description="Every correction applied from the form above lands here with its reason, newest first." />
        )}
        <ListCap shown={history.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="adjustments" hint="the stock movement report (Inventory → Reports)" />
      </Card>
    </div>
  );
}
