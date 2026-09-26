'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, PackagePlus, Plus, RefreshCw, RotateCcw, ShoppingCart, Truck, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { purchaseApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';
import { todayLocal } from '../../../../lib/report-range';

/**
 * Goods receipts — what actually arrived against each purchase order.
 *
 * A stage strip (not posted / in stock / reversed / cancelled) with live
 * counts doubles as the filter, a summary pill counts the receipts waiting
 * to be posted, a note reminds that a draft is not yet in stock, and each
 * receipt is one row: number and date with the supplier's challan and the
 * truck, the supplier and the order it was received against, the
 * materials with received and accepted quantities (rejections in red), the
 * bill raised on it, the stage, and Post to stock / Cancel / Reverse / Bill
 * it. The new-receipt form opens on demand (or straight away when arriving
 * from an order with ?po=) with a line per outstanding order line, received
 * and accepted prefilled with what is still due. Same layout in both skins;
 * every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'Not posted', tone: 'warning', hint: 'Written up; the stock does not move until it is posted' },
  { key: 'posted', label: 'In stock', tone: 'success', hint: 'Posted; the accepted quantity is in stock and the bill can be raised' },
  { key: 'reversed', label: 'Reversed', tone: 'danger', hint: 'Taken back out of stock; the order lines were rewound' },
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral', hint: 'Discarded before posting; nothing reached stock' },
];
const stageOf = (r: Row) => String(r.status ?? 'draft');
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;

type GrnLine = {
  poItemId: string; materialId: string; materialLabel: string; uom: string;
  ordered: number; remaining: number; received: string; accepted: string; rate: number;
};

export default function GoodsReceiptsPage() {
  const { confirm, prompt } = useConfirm();
  const canReverse = getAccess().has('vendor_bills.approve');
  const canCreate = getAccess().has('grn.create');
  const [rows, setRows] = useState<Row[]>([]);
  const [openPos, setOpenPos] = useState<Row[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [poId, setPoId] = useState('');
  const [po, setPo] = useState<Row | null>(null);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [head, setHead] = useState({ supplierChallanNo: '', vehicleNo: '', receiptDate: todayLocal() });
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const win = useListWindow();

  const reload = useCallback(async () => {
    const [g, o] = await Promise.all([purchaseApi.grns(undefined, win.limit), purchaseApi.orders()]);
    setRows(g);
    setOpenPos((o as Row[]).filter((p) => ['issued', 'partially_received'].includes(String(p.status))));
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  // Arriving with ?po=<id> (the Receive button on an order) opens the form on that order.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('po');
    if (q) {
      setShowForm(true);
      pickPo(q).catch((e) => setError(String(e)));
    }
  }, []);

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

  async function pickPo(id: string) {
    setPoId(id);
    setError(null);
    setMsg(null);
    if (!id) {
      setPo(null);
      setLines([]);
      return;
    }
    const full = await purchaseApi.order(id);
    setPo(full);
    const items = (full.items as Row[]) ?? [];
    setLines(
      items
        .map((it) => {
          const ordered = num(it.quantity);
          const remaining = Math.max(0, ordered - num(it.receivedQuantity));
          return {
            poItemId: String(it.id), materialId: String(it.materialId ?? ''),
            materialLabel: String(it.materialLabel ?? ''), uom: String(it.uom ?? ''),
            ordered, remaining, received: String(remaining), accepted: String(remaining), rate: num(it.rate),
          };
        })
        .filter((l) => l.remaining > 0.0005),
    );
  }

  const setLine = (i: number, patch: Partial<GrnLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const payloadLines = lines
      .map((l) => ({
        purchaseOrderItemId: l.poItemId, materialId: l.materialId, materialLabel: l.materialLabel, uom: l.uom,
        receivedQuantity: num(l.received), acceptedQuantity: num(l.accepted), rate: l.rate,
      }))
      .filter((l) => l.receivedQuantity > 0);
    if (!poId) { setError('Pick the purchase order the delivery is against.'); return; }
    if (!payloadLines.length) { setError('Enter what was received on at least one line.'); return; }
    if (payloadLines.some((l) => l.acceptedQuantity > l.receivedQuantity + 0.0005)) {
      setError('Accepted cannot be more than received.');
      return;
    }
    setBusy(true);
    try {
      const grn = await purchaseApi.createGrn({
        purchaseOrderId: poId, plantId: po?.plantId ?? undefined,
        receiptDate: head.receiptDate || todayLocal(),
        supplierChallanNo: head.supplierChallanNo || undefined, vehicleNo: head.vehicleNo || undefined,
        lines: payloadLines,
      });
      setMsg(`${String(grn.grnNo)} written up. Post it to stock once the material is checked in; the bill is raised from the posted receipt.`);
      setPoId('');
      setPo(null);
      setLines([]);
      setHead({ supplierChallanNo: '', vehicleNo: '', receiptDate: todayLocal() });
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
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
  const drafts = counts.get('draft') ?? 0;
  const formReceived = lines.reduce((t, l) => t + num(l.received), 0);
  const formRejected = lines.reduce((t, l) => t + Math.max(0, num(l.received) - num(l.accepted)), 0);

  return (
    <div className="mn-ord mn-gr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Goods receipts</h1>
          <p>What actually arrived at the gate, against the order it was bought on: the supplier&rsquo;s challan, the truck, and per material what was received and what was accepted. Posting a receipt puts the accepted quantity into stock; the supplier&rsquo;s bill is then raised from it.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <PackagePlus size={14} aria-hidden />
            {loaded ? `${drafts} to post · ${openPos.length} ${openPos.length === 1 ? 'order' : 'orders'} open` : 'Loading…'}
          </span>
          {canCreate && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New receipt</Button>}
          <Link href="/app/purchase/orders" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ShoppingCart size={14} />}>Purchase orders</Button>
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

      {loaded && drafts > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
            <PackagePlus size={16} aria-hidden />
            <span><strong>{drafts} {drafts === 1 ? 'receipt is' : 'receipts are'} written up but not posted.</strong> The material is at the plant but not on the books: post each one once it is checked in, so batching does not run the stock negative.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canCreate && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New goods receipt</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => { setShowForm(false); setPoId(''); setPo(null); setLines([]); }}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-gr-form">
            <div className="mn-gr-form-head">
              <Field label="Purchase order" required help={openPos.length ? 'Only issued orders with something still due are listed.' : 'No open orders: issue a purchase order first.'}>
                <Select value={poId} onChange={(e) => pickPo(e.target.value).catch((err) => setError(String(err)))} required>
                  <option value="">Choose the order…</option>
                  {openPos.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>{String(p.poNo)}{p.supplierName ? ` · ${String(p.supplierName)}` : ''}{p.materialLabels ? ` · ${String(p.materialLabels)}` : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Supplier's challan no" help="The number on the delivery note that came with the truck.">
                <Input value={head.supplierChallanNo} onChange={(e) => setHead({ ...head, supplierChallanNo: e.target.value })} />
              </Field>
              <Field label="Vehicle no">
                <Input value={head.vehicleNo} onChange={(e) => setHead({ ...head, vehicleNo: e.target.value })} placeholder="TN 22 AB 9087" />
              </Field>
              <Field label="Received on">
                <Input type="date" max={todayLocal()} value={head.receiptDate} onChange={(e) => setHead({ ...head, receiptDate: e.target.value })} />
              </Field>
            </div>
            {poId ? (lines.length ? (
              <>
                <p className="mn-board-form-hint" style={{ margin: '0 0 8px' }}>
                  <strong>Received</strong> is what came off the truck; <strong>accepted</strong> is what passed the check and goes into stock. Lower accepted for damp cement, wrong grading, short weight; the difference is the rejection. Both start at what is still due on the order.
                </p>
                <div className="mn-gr-lines">
                  <div className="mn-gr-line mn-gr-line--head" aria-hidden>
                    <span>Material</span>
                    <span className="is-num">Ordered</span>
                    <span className="is-num">Still due</span>
                    <span className="is-num">Received</span>
                    <span className="is-num">Accepted</span>
                  </div>
                  {lines.map((l, i) => {
                    const rejected = Math.max(0, num(l.received) - num(l.accepted));
                    return (
                      <div key={l.poItemId} className="mn-gr-line">
                        <span className="mn-gr-line-mat"><span className="mn-od-num">{l.materialLabel}</span><span className="mn-od-rate-meta">{l.uom || ''}{rejected > 0 ? ` · ${qty(rejected)} rejected` : ''}</span></span>
                        <span className="is-num">{qty(l.ordered)}</span>
                        <span className="is-num">{qty(l.remaining)}</span>
                        <Input type="number" step="any" min={0} inputMode="decimal" className="is-num" aria-label={`Received ${l.materialLabel}`} value={l.received} onChange={(e) => setLine(i, { received: e.target.value, accepted: num(l.accepted) > num(e.target.value) ? e.target.value : l.accepted })} />
                        <Input type="number" step="any" min={0} max={num(l.received) || undefined} inputMode="decimal" className={`is-num${rejected > 0 ? ' mn-gr-rej' : ''}`} aria-label={`Accepted ${l.materialLabel}`} value={l.accepted} onChange={(e) => setLine(i, { accepted: e.target.value })} />
                      </div>
                    );
                  })}
                </div>
                <div className="mn-gr-form-foot">
                  <span className="mn-ord-how">{formReceived > 0 ? `${qty(formReceived)} received${formRejected > 0 ? `, ${qty(formRejected)} rejected` : ''}. Saved as not posted; post it once checked in.` : 'Enter what came off the truck.'}</span>
                  <div className="mn-gr-form-submit">
                    <Button type="submit" loading={busy} icon={<PackagePlus size={14} />}>Write up the receipt</Button>
                    <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setPoId(''); setPo(null); setLines([]); }}>Cancel</Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="mn-board-form-hint">Nothing is left to receive on {String(po?.poNo ?? 'this order')}: every line has arrived in full.</p>
            )) : (
              <p className="mn-board-form-hint">Pick the order first; its lines appear here with what is still due.</p>
            )}
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> Receipts <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Post to stock once the material is checked in; then raise the bill from it.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Receipt</span>
              <span>Supplier · order</span>
              <span>Materials</span>
              <span>Accepted</span>
              <span>Bill</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const id = String(r.id);
              const received = num(r.receivedQty);
              const accepted = num(r.acceptedQty);
              const rejected = Math.max(0, received - accepted);
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts mn-gr-row${stage === 'cancelled' || stage === 'reversed' ? ' is-void' : ''}`} data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.grnNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDate(r.receiptDate ?? r.createdAt)}{r.supplierChallanNo ? <><span className="mn-ord-dot" aria-hidden>·</span>challan {String(r.supplierChallanNo)}</> : null}</span>
                    {r.vehicleNo ? <span className="mn-ord-meta">{String(r.vehicleNo)}</span> : null}
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.supplierName ?? 'Supplier not set')}</span>
                    <span className="mn-ord-meta">{r.poNo ? `against ${String(r.poNo)}` : 'No purchase order'}{r.plantName ? <><span className="mn-ord-dot" aria-hidden>·</span>{String(r.plantName)}</> : null}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{r.materialLabels ? String(r.materialLabels) : <span className="mn-ord-meta">No lines</span>}</span>
                    <span className="mn-ord-meta">{num(r.itemCount)} {num(r.itemCount) === 1 ? 'line' : 'lines'}</span>
                  </div>
                  <div className="mn-ord-val mn-gr-qty">
                    <span className="mn-ord-amt">{qty(accepted)}</span>
                    <span className={`mn-ord-meta${rejected > 0 ? ' mn-gr-rej-text' : ''}`}>{rejected > 0 ? `${qty(received)} received · ${qty(rejected)} rejected` : `all ${qty(received)} received accepted`}</span>
                  </div>
                  <div className="mn-gr-bill">
                    {r.billNo ? (
                      <>
                        <Link href="/app/purchase/bills" className="mn-id-link">{String(r.billNo)}</Link>
                        <span className="mn-ord-meta">{String(r.billStatus ?? '').replace(/_/g, ' ')}</span>
                      </>
                    ) : stage === 'posted' ? (
                      <Link href={`/app/purchase/bills?grn=${id}`} className="mn-ord-link"><Button size="sm" variant="ghost" icon={<FileText size={14} />}>Bill it</Button></Link>
                    ) : (
                      <span className="mn-ord-meta">{stage === 'draft' ? 'After posting' : '—'}</span>
                    )}
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={stage} />
                    {rejected > 0 && stage !== 'cancelled' ? <Badge tone="danger">rejection</Badge> : null}
                  </div>
                  <div className="mn-ord-act mn-gr-acts">
                    {canCreate && stage === 'draft' && (
                      <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Post ${String(r.grnNo)} to stock`, message: `${qty(accepted)} accepted goes into stock at ${String(r.plantName ?? 'the plant')}${rejected > 0 ? `; the ${qty(rejected)} rejected stays off the books` : ''}. The order's received quantity moves up and the supplier's bill can be raised. This cannot be undone here; a posted receipt can only be reversed.`, confirmLabel: 'Post to stock' }))) return;
                        act(() => purchaseApi.postGrn(id), `${String(r.grnNo)} posted: ${qty(accepted)} added to stock.`);
                      }}>Post to stock</Button>
                    )}
                    {canCreate && stage === 'draft' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Cancel ${String(r.grnNo)}`, message: 'The receipt is discarded; nothing was posted to stock and the order is untouched.', confirmLabel: 'Cancel receipt', danger: true }))) return;
                        act(() => purchaseApi.cancelGrn(id), `${String(r.grnNo)} cancelled.`);
                      }}>Cancel</Button>
                    )}
                    {canReverse && stage === 'posted' && (
                      <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Reverse ${String(r.grnNo)}`, message: `${qty(accepted)} is taken back out of stock and the order lines are rewound so the material can be received again. A bill raised on this receipt must be cancelled first.`, confirmLabel: 'Reverse', danger: true }))) return;
                        const reason = await prompt({ title: `Reverse ${String(r.grnNo)}`, label: 'Why (short delivery, wrong order, duplicate…)', defaultValue: '' });
                        if (reason === null) return;
                        act(() => purchaseApi.reverseGrn(id, reason), `${String(r.grnNo)} reversed; the stock is back where it was.`);
                      }}>Reverse</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} receipts` : 'No goods receipts yet'}
            description={filter ? 'Press the chip again to see every receipt.' : canCreate ? 'When a delivery arrives, press New receipt, pick the purchase order it is against and enter what came off the truck.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all receipts</Button> : canCreate ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New receipt</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="goods receipts" />
      </Card>
    </div>
  );
}
