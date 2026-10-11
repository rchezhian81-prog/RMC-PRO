'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, Hourglass, PackagePlus, Plus, RefreshCw, Send, Share2, ShoppingCart, Trash2, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { convertUom, reachableUoms, type UomConversionRow } from '@rmc/shared';
import { crud, purchaseApi, openPdf, openWhatsAppShare, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';
import { todayLocal } from '../../../../lib/report-range';

/**
 * Purchase orders — what has been ordered from suppliers and how much of it
 * has arrived.
 *
 * A stage strip (draft / waiting for delivery / partly received / received /
 * closed / cancelled) with live counts doubles as the filter, a summary pill
 * totals what is on order, a note counts the orders past their expected
 * date, and each order is one row: number and dates, the supplier and
 * plant, the materials and quantities, the value with its tax, how much has
 * arrived as a bar with the receipts and bills against it, the stage, and
 * Print / Send / Issue / Receive / Cancel as the state allows. The new-order
 * form opens on demand with a line per material and the rate filled from
 * the material's standard rate. Same layout in both skins; every colour
 * reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Draft', tone: 'info', hint: 'Being prepared; issue it to send it to the supplier' },
  { key: 'issued', label: 'Waiting for delivery', tone: 'warning', hint: 'Issued to the supplier; nothing received yet' },
  { key: 'partially_received', label: 'Partly received', tone: 'warning', hint: 'Some of it has arrived; the rest is still due' },
  { key: 'received', label: 'Received', tone: 'success', hint: 'Everything ordered has arrived' },
  { key: 'closed', label: 'Closed', tone: 'neutral', hint: 'Finished; nothing more expected' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn before anything was received' },
];
const stageOf = (r: Row) => String(r.status ?? 'draft');
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;
const OPEN = ['issued', 'partially_received'];

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** The latest an order may be dated: tomorrow, in the browser's local calendar. */
function tomorrowLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return todayLocal(d);
}

/** Round to the nearest rupee (half away from zero) and the signed paise that got there. */
function roundToRupee(grand: number): { roundOff: number; total: number } {
  const total = Math.sign(grand) * Math.round(Math.abs(grand));
  return { roundOff: Math.round((total - grand) * 100) / 100, total };
}

/** `uom` is the unit the quantity is keyed in — the material's own, or one convertible from it. */
interface LineDraft { materialId: string; uom: string; quantity: string; rate: string; discountPct: string; gstRate: string }
const emptyLine = (): LineDraft => ({ materialId: '', uom: '', quantity: '', rate: '', discountPct: '', gstRate: '18' });

export default function PurchaseOrdersPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [conversions, setConversions] = useState<UomConversionRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [plantId, setPlantId] = useState('');
  const [orderDate, setOrderDate] = useState(() => todayLocal());
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();
  const canCreate = getAccess().has('purchase_orders.create');
  const canReceive = getAccess().has('grn.create');

  const reload = useCallback(async () => {
    const [o, s, mt, p, c] = await Promise.all([
      purchaseApi.orders(undefined, win.limit), crud('suppliers').list({ active: true }), crud('materials').list({ active: true }), crud('plants').list({ active: true }),
      crud('uom-conversions').list(),
    ]);
    setRows(o);
    setSuppliers(s);
    setMaterials(mt);
    setPlants(p);
    setConversions(c.map((r) => ({ from: String(r.fromUom ?? ''), to: String(r.toUom ?? ''), factor: num(r.factor) })));
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  // Picking a material fills its standard rate, so the usual price is one
  // keystroke away and a typo in the rate stands out against it.
  function pickMaterial(i: number, materialId: string) {
    const mt = materials.find((x) => String(x.id) === materialId);
    setLine(i, { materialId, uom: String(mt?.uom ?? ''), rate: mt && num(mt.standardRate) > 0 ? String(num(mt.standardRate)) : '' });
  }
  const materialOf = (l: LineDraft) => materials.find((x) => String(x.id) === l.materialId);
  /** The units a line may be keyed in: the material's own plus every unit a conversion reaches. */
  const unitsFor = (l: LineDraft) => reachableUoms(materialOf(l)?.uom as string | undefined, conversions);
  /** The keyed quantity in the material's own unit (the rate is per that unit). */
  const ownQty = (l: LineDraft) => {
    const own = String(materialOf(l)?.uom ?? '');
    if (!l.uom || !own || l.uom === own) return num(l.quantity);
    return convertUom(num(l.quantity), l.uom, own, conversions) ?? 0;
  };
  const lineTaxable = (l: LineDraft) => ownQty(l) * num(l.rate) * (1 - num(l.discountPct) / 100);
  const lineTotal = (l: LineDraft) => lineTaxable(l) * (1 + num(l.gstRate) / 100);
  const formTaxable = lines.reduce((t, l) => t + lineTaxable(l), 0);
  const formTax = lines.reduce((t, l) => t + (lineTotal(l) - lineTaxable(l)), 0);
  const formRound = roundToRupee(formTaxable + formTax);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (lines.some((l) => l.materialId && (num(l.discountPct) < 0 || num(l.discountPct) > 100))) { setError('A discount must be between 0 and 100 percent.'); return; }
    const payloadLines = lines
      .filter((l) => l.materialId && num(l.quantity) > 0)
      .map((l) => {
        const material = materialOf(l);
        const own = String(material?.uom ?? '');
        const other = l.uom && own && l.uom !== own;
        return {
          materialId: l.materialId, materialLabel: material?.materialName, uom: own || undefined,
          quantity: other ? ownQty(l) : num(l.quantity),
          ...(other ? { enteredUom: l.uom, enteredQuantity: num(l.quantity) } : {}),
          rate: num(l.rate), discountPct: num(l.discountPct), gstRate: num(l.gstRate),
        };
      });
    if (!supplierId) { setError('Pick the supplier.'); return; }
    if (!orderDate) { setError('Enter the order date.'); return; }
    if (!payloadLines.length) { setError('Add at least one line with a material and a quantity.'); return; }
    setBusy(true);
    try {
      const po = await purchaseApi.createOrder({ supplierId, plantId: plantId || undefined, orderDate, expectedDate: expectedDate || undefined, lines: payloadLines });
      setMsg(`${String(po.poNo)} created as a draft for ${money(po.totalAmount)}. Issue it to send it to the supplier.`);
      setSupplierId('');
      setPlantId('');
      setOrderDate(todayLocal());
      setExpectedDate('');
      setLines([emptyLine()]);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const open = rows.filter((r) => OPEN.includes(stageOf(r)));
  const onOrder = open.reduce((t, r) => t + num(r.totalAmount), 0);
  const late = open.filter((r) => (daysUntil(r.expectedDate) ?? 1) < 0);

  return (
    <div className="mn-ord mn-pu">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Purchase orders</h1>
          <p>What you have ordered from suppliers, and how much of it has come in. Raise an order, issue it to the supplier, then book each delivery against it under Goods receipts so stock and the supplier&rsquo;s bill both tie back to what was ordered.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ShoppingCart size={14} aria-hidden />
            {loaded ? `${open.length} open · ${moneyShort(onOrder)} on order` : 'Loading…'}
          </span>
          {canCreate && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New order</Button>}
          <Link href="/app/purchase/goods-receipts" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<PackagePlus size={14} />}>Goods receipts</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Stage strip — counts per stage; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
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

      {loaded && late.length > 0 && !filter && (
        <div className="mn-ord-notes">
          <div className="mn-ord-note mn-ord-note--warn">
            <Hourglass size={16} aria-hidden />
            <span><strong>{late.length} {late.length === 1 ? 'order is' : 'orders are'} past the date the supplier promised: {late.slice(0, 3).map((r) => String(r.poNo)).join(', ')}{late.length > 3 ? ` and ${late.length - 3} more` : ''}.</strong> Chase the supplier, or cancel and order elsewhere before the stock runs low.</span>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canCreate && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New purchase order</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-pu-form">
            <div className="mn-pu-form-head">
              <Field label="Supplier" required>
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                  <option value="">Choose…</option>
                  {suppliers.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.supplierName)}</option>)}
                </Select>
              </Field>
              <Field label="Deliver to plant" help={plants.length === 1 ? 'Your only plant.' : 'Where the stock is booked when it arrives.'}>
                <Select value={plantId || (plants.length === 1 ? String(plants[0]?.id ?? '') : '')} onChange={(e) => setPlantId(e.target.value)}>
                  <option value="">Default plant</option>
                  {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
                </Select>
              </Field>
              <Field label="Order date" required help="The day the order was placed; it may be backdated, but not set beyond tomorrow.">
                <Input type="date" max={tomorrowLocal()} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
              </Field>
              <Field label="Expected by" help="The date the supplier promised; late orders are flagged.">
                <Input type="date" min={todayLocal()} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </Field>
            </div>
            <div className="mn-pu-lines">
              <div className="mn-pu-line mn-pu-line--head" aria-hidden>
                <span>Material</span>
                <span>Unit</span>
                <span className="is-num">Quantity</span>
                <span className="is-num">Rate</span>
                <span className="is-num">Discount %</span>
                <span className="is-num">GST %</span>
                <span className="is-num">Line value</span>
                <span />
              </div>
              {lines.map((l, i) => {
                const mt = materialOf(l);
                const units = unitsFor(l);
                const own = String(mt?.uom ?? '');
                const converted = l.uom && own && l.uom !== own && num(l.quantity) > 0;
                return (
                  <div key={i} className="mn-pu-line">
                    <Select value={l.materialId} onChange={(e) => pickMaterial(i, e.target.value)} aria-label="Material">
                      <option value="">Choose a material…</option>
                      {materials.map((m) => <option key={String(m.id)} value={String(m.id)}>{String(m.materialName)}{m.uom ? ` (${String(m.uom)})` : ''}</option>)}
                    </Select>
                    <Select value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} aria-label="Unit" disabled={units.length <= 1} title={units.length > 1 ? 'The material\'s own unit, or one a conversion reaches' : own ? `Stocked in ${own}; add a unit conversion to order in another unit` : 'Pick a material first'}>
                      {!units.length && <option value="">unit</option>}
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Select>
                    <Input type="number" step="any" min={0} inputMode="decimal" className="is-num" placeholder={l.uom || own || 'qty'} aria-label="Quantity" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} title={converted ? `${qty(ownQty(l))} ${own}` : undefined} />
                    <Input type="number" step="any" min={0} inputMode="decimal" className="is-num" placeholder={own ? `₹ per ${own}` : '₹ per unit'} aria-label="Rate" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                    <Input type="number" step="any" min={0} max={100} inputMode="decimal" className="is-num" placeholder="0" aria-label="Discount percent" value={l.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} />
                    <Input type="number" step="any" min={0} inputMode="decimal" className="is-num" aria-label="GST percent" value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} />
                    <span className="mn-pu-line-total is-num" title={converted ? `${qty(ownQty(l))} ${own} at ${money(l.rate)}` : undefined}>{lineTotal(l) > 0 ? money(lineTotal(l)) : '—'}</span>
                    <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} />
                  </div>
                );
              })}
            </div>
            <div className="mn-pu-form-foot">
              <Button type="button" variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setLines((p) => [...p, emptyLine()])}>Add a line</Button>
              {formTaxable > 0 ? (
                <dl className="mn-pu-totals" aria-label="Order totals">
                  <dt>Taxable</dt><dd>{money(formTaxable)}</dd>
                  <dt>GST</dt><dd>{money(formTax)}</dd>
                  <dt>Round-off</dt><dd>{formRound.roundOff === 0 ? '—' : money(formRound.roundOff)}</dd>
                  <dt>Grand total</dt><dd className="mn-pu-totals-grand">{money(formRound.total)}</dd>
                </dl>
              ) : (
                <span className="mn-ord-how">The rate fills in from the material&rsquo;s standard rate and is per the material&rsquo;s own unit; change it if the supplier quoted differently. Pick another unit on a line to order in bags or litres where a conversion is set up.</span>
              )}
              <div className="mn-pu-form-submit">
                <Button type="submit" loading={busy} icon={<ShoppingCart size={14} />}>Create order</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><ShoppingCart size={16} aria-hidden /> Orders <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Receive books a delivery against the order; the bill comes from the receipt.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Order</span>
              <span>Supplier</span>
              <span>Materials</span>
              <span className="is-num">Value</span>
              <span>Arrived</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const id = String(r.id);
              const ordered = num(r.orderedQty);
              const received = num(r.receivedQty);
              const pct = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
              const due = daysUntil(r.expectedDate);
              const lateBy = OPEN.includes(stage) && due != null && due < 0 ? -due : 0;
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts mn-pu-row${stage === 'cancelled' ? ' is-void' : ''}`} data-tone={lateBy ? 'danger' : toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.poNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDate(r.orderDate ?? r.createdAt)}</span>
                    {r.expectedDate ? <span className={`mn-ord-meta${lateBy ? ' mn-pu-late' : ''}`}>{lateBy ? `${lateBy} ${lateBy === 1 ? 'day' : 'days'} late` : OPEN.includes(stage) ? `expected ${formatDate(r.expectedDate)}` : `expected ${formatDate(r.expectedDate)}`}</span> : null}
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.supplierName ?? 'Supplier not set')}</span>
                    <span className="mn-ord-meta">{r.plantName ? String(r.plantName) : 'Default plant'}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{r.materialLabels ? String(r.materialLabels) : <span className="mn-ord-meta">No lines</span>}</span>
                    <span className="mn-ord-meta">{num(r.itemCount)} {num(r.itemCount) === 1 ? 'line' : 'lines'} · {qty(ordered)} ordered</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.totalAmount)}</span>
                    <span className="mn-ord-meta">{money(r.taxableAmount)} + {money(r.taxAmount)} GST</span>
                  </div>
                  <div className="mn-pu-progress" data-tone={pct >= 100 ? 'success' : pct > 0 ? 'warning' : 'neutral'}>
                    {stage === 'draft' || stage === 'cancelled' ? (
                      <span className="mn-ord-meta">{stage === 'draft' ? 'Not issued yet' : 'Nothing received'}</span>
                    ) : (
                      <>
                        <span className="mn-cu-bar mn-pu-bar" role="img" aria-label={`${Math.round(pct)}% received`}><span style={{ width: `${pct}%` }} /></span>
                        <span className="mn-ord-meta"><strong>{qty(received)}</strong> of {qty(ordered)} received{num(r.grnCount) ? ` · ${num(r.grnCount)} ${num(r.grnCount) === 1 ? 'receipt' : 'receipts'}` : ''}{num(r.billCount) ? ` · ${num(r.billCount)} ${num(r.billCount) === 1 ? 'bill' : 'bills'}` : ''}</span>
                      </>
                    )}
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={stage} /></div>
                  <div className="mn-ord-act mn-pu-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/purchase-orders/${id}/pdf`, String(r.poNo ?? '')).catch((e) => setError(String(e)))}>Print</Button>
                    {stage !== 'draft' && stage !== 'cancelled' && (
                      <Button variant="ghost" size="sm" icon={<Share2 size={14} />} disabled={busy} onClick={async () => {
                        const m = await prompt({ title: `Send ${String(r.poNo)} to the supplier`, label: 'Supplier mobile (WhatsApp)', defaultValue: '' });
                        if (m === null) return;
                        act(() => openWhatsAppShare(() => purchaseApi.shareOrder(id, m)));
                      }}>Send</Button>
                    )}
                    {canCreate && stage === 'draft' && (
                      <Button size="sm" icon={<Send size={14} />} disabled={busy} onClick={() => act(() => purchaseApi.issueOrder(id), `${String(r.poNo)} issued. Send it to the supplier, then receive the delivery against it.`)}>Issue</Button>
                    )}
                    {canReceive && OPEN.includes(stage) && (
                      <Link href={`/app/purchase/goods-receipts?po=${id}`} className="mn-ord-link"><Button size="sm" variant="secondary" icon={<PackagePlus size={14} />}>Receive</Button></Link>
                    )}
                    {canCreate && stage === 'draft' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Cancel ${String(r.poNo)}`, message: 'The draft is withdrawn; nothing was sent to the supplier and nothing changes in stock. This cannot be undone.', confirmLabel: 'Cancel order', danger: true }))) return;
                        act(() => purchaseApi.cancelOrder(id), `${String(r.poNo)} cancelled.`);
                      }}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} orders` : 'No purchase orders yet'}
            description={filter ? 'Press the chip again to see every order.' : canCreate ? 'Raise the first order with New order: pick the supplier, add a line per material with the quantity and rate, then issue it.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all orders</Button> : canCreate ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New order</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="purchase orders" hint="the purchase register (Purchase › Reports)" />
      </Card>
    </div>
  );
}
