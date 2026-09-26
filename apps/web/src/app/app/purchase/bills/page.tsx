'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, FileText, Landmark, PackagePlus, Plus, RefreshCw, RotateCcw, ShieldAlert, Wallet, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money, moneyShort } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { purchaseApi, type Row, openPdf } from '../../../../lib/api';
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
 * Vendor bills — what suppliers have billed, whether it matches what was
 * ordered and received, and what is still to pay.
 *
 * A stage strip (to approve / to pay / partly paid / paid / cancelled)
 * with live counts doubles as the filter, a summary pill totals what is
 * owed to suppliers, notes flag bills whose match failed and the drafts
 * waiting for approval, and each bill is one row: number and the
 * supplier's own bill number and date, the supplier with the order and
 * receipt it came from, the materials, the amount with its tax and what is
 * still owed, the three-way match with the credit flag, the stage, and
 * Approve / Pay / Cancel. Payments made to suppliers sit in a second card
 * with Print and Reverse. The new-bill form opens on demand (or from a
 * posted receipt with ?grn=). Same layout in both skins; every colour reads
 * the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'draft', label: 'To approve', tone: 'warning', hint: 'Raised from a receipt; check the match and approve it to commit the payable' },
  { key: 'due', label: 'To pay', tone: 'info', hint: 'Approved; nothing paid yet' },
  { key: 'part', label: 'Partly paid', tone: 'info', hint: 'Approved; some of it paid' },
  { key: 'paid', label: 'Paid', tone: 'success', hint: 'Settled in full' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Withdrawn; the receipt can be billed again' },
];
function stageOf(r: Row): string {
  const st = String(r.status ?? 'draft');
  if (st === 'cancelled' || st === 'draft') return st;
  const ps = String(r.paymentStatus ?? 'unpaid');
  if (ps === 'paid' || num(r.outstandingAmount) <= 0.001) return 'paid';
  if (ps === 'partially_paid' || num(r.paidAmount) > 0.001) return 'part';
  return 'due';
}
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;
const MODES = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
];
const modeOf = (m: unknown) => MODES.find((x) => x.value === String(m ?? ''))?.label ?? (m ? String(m).replace(/_/g, ' ') : '—');

export default function VendorBillsPage() {
  const { confirm, prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [grns, setGrns] = useState<Row[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [grnId, setGrnId] = useState('');
  const [supplierBillNo, setSupplierBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayLocal());
  const [itcEligible, setItcEligible] = useState(true);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();
  const canCreate = getAccess().has('vendor_bills.create');
  const canApprove = getAccess().has('vendor_bills.approve');
  const canPay = getAccess().has('vendor_payments.create');

  const reload = useCallback(async () => {
    const [b, g, p] = await Promise.all([purchaseApi.bills(undefined, win.limit), purchaseApi.grns('posted'), purchaseApi.payments(win.limit)]);
    setRows(b);
    setGrns(g);
    setPayments(p);
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  // Arriving with ?grn=<id> (Bill it on a posted receipt) opens the form on that receipt.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('grn');
    if (q) {
      setGrnId(q);
      setShowForm(true);
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

  // Posted receipts that do not yet carry a live bill: the ones that can be billed.
  const billable = useMemo(() => grns.filter((g) => !g.billNo || String(g.billStatus) === 'cancelled'), [grns]);

  async function createBill(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const grn = grns.find((g) => String(g.id) === grnId);
    if (!grn) { setError('Pick the posted goods receipt the bill is for.'); return; }
    setBusy(true);
    try {
      const bill = await purchaseApi.createBill({
        supplierId: grn.supplierId, goodsReceiptId: grn.id, purchaseOrderId: grn.purchaseOrderId ?? undefined,
        supplierBillNo: supplierBillNo || undefined, billDate: billDate || todayLocal(),
        itcEligible,
      });
      const match = String(bill.matchStatus ?? '');
      setMsg(`${String(bill.billNo)} raised for ${money(bill.totalAmount)}: ${match === 'matched' ? 'it matches the order and the receipt; approve it to commit the payable.' : match === 'over_tolerance' ? 'it does NOT match the order and receipt within tolerance. Check the quantities and rates before approving.' : 'no order to match against; check it by hand before approving.'}`);
      setGrnId('');
      setSupplierBillNo('');
      setBillDate(todayLocal());
      setItcEligible(true);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function pay(bill: Row) {
    const outstanding = num(bill.outstandingAmount);
    if (!(outstanding > 0)) return;
    const amountStr = await prompt({
      title: `Pay ${String(bill.billNo)}`,
      message: `${String(bill.supplierName ?? 'The supplier')} is owed ${money(outstanding)} on this bill. Enter what is being paid now; anything less leaves the rest outstanding.`,
      label: 'Amount (₹)',
      defaultValue: String(outstanding),
      type: 'number',
      confirmLabel: 'Next',
    });
    if (amountStr === null) return;
    const amount = num(amountStr);
    if (amount <= 0 || amount > outstanding + 0.001) { setError(`The amount must be between ₹1 and ${money(outstanding)}.`); return; }
    const mode = await prompt({
      title: `Pay ${money(amount)} to ${String(bill.supplierName ?? 'the supplier')}`,
      label: 'How it was paid',
      options: MODES,
      defaultValue: 'neft',
      confirmLabel: 'Next',
    });
    if (mode === null) return;
    const ref = await prompt({ title: `Pay ${money(amount)}`, label: mode === 'cheque' ? 'Cheque number' : mode === 'cash' ? 'Reference (optional)' : 'UTR / bank reference', defaultValue: '', confirmLabel: 'Record payment' });
    if (ref === null) return;
    await act(
      () => purchaseApi.createPayment({ supplierId: bill.supplierId, amount, paymentMode: mode, bankReference: ref || undefined, allocations: [{ billId: bill.id, amount }] }),
      `${money(amount)} paid to ${String(bill.supplierName ?? 'the supplier')} against ${String(bill.billNo)}${amount < outstanding - 0.001 ? `; ${money(outstanding - amount)} still owed` : '; the bill is settled'}.`,
    );
  }

  async function reverse(payment: Row) {
    const reason = await prompt({
      title: `Reverse ${String(payment.paymentNo)}`,
      message: `${money(payment.amount)} to ${String(payment.supplierName ?? 'the supplier')} is taken back: each bill it paid${payment.billNos ? ` (${String(payment.billNos)})` : ''} goes back to owing that amount. Use it for a payment keyed wrongly or a transfer that bounced.`,
      label: 'Why (optional)',
      placeholder: 'e.g. allocated to the wrong bill',
      defaultValue: '',
      confirmLabel: 'Reverse',
    });
    if (reason === null) return;
    await act(() => purchaseApi.reversePayment(String(payment.id), reason || undefined), `${String(payment.paymentNo)} reversed.`);
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(stageOf(r), (m.get(stageOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (filter ? rows.filter((r) => stageOf(r) === filter) : rows), [rows, filter]);
  const owed = rows.filter((r) => String(r.status) === 'approved').reduce((t, r) => t + num(r.outstandingAmount), 0);
  const toApprove = counts.get('draft') ?? 0;
  const mismatched = rows.filter((r) => String(r.status) === 'draft' && String(r.matchStatus) === 'over_tolerance');
  const paidOut = payments.filter((p) => String(p.status) !== 'reversed').reduce((t, p) => t + num(p.amount), 0);

  return (
    <div className="mn-ord mn-vb">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Vendor bills</h1>
          <p>What suppliers have billed you, checked three ways against what was ordered and what was received. Raise the bill from a posted receipt, approve it once the match is right, then pay it here so what you owe each supplier stays true.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wallet size={14} aria-hidden />
            {loaded ? `${moneyShort(owed)} owed to suppliers · ${toApprove} to approve` : 'Loading…'}
          </span>
          {canCreate && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New bill</Button>}
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

      {loaded && (mismatched.length > 0 || toApprove > 0) && !filter && (
        <div className="mn-ord-notes">
          {mismatched.length > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <ShieldAlert size={16} aria-hidden />
              <span><strong>{mismatched.length} {mismatched.length === 1 ? 'bill does' : 'bills do'} not match the order and the receipt: {mismatched.map((r) => String(r.billNo)).join(', ')}.</strong> The supplier billed more than was received or at a different rate. Sort it out with them before approving.</span>
            </button>
          )}
          {toApprove > mismatched.length && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('draft')}>
              <FileText size={16} aria-hidden />
              <span><strong>{toApprove - mismatched.length} {toApprove - mismatched.length === 1 ? 'bill matches and is' : 'bills match and are'} waiting for approval.</strong> Approving commits the payable and puts its GST into the input credit register.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canCreate && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New vendor bill</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={createBill} className="mn-vb-form">
            <Field label="Goods receipt" required help={billable.length ? 'Only posted receipts without a bill are listed; the bill takes its lines and rates from the order.' : 'No posted receipt is waiting for a bill.'}>
              <Select value={grnId} onChange={(e) => setGrnId(e.target.value)} required>
                <option value="">Choose the receipt…</option>
                {billable.map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.grnNo)}{g.supplierName ? ` · ${String(g.supplierName)}` : ''}{g.poNo ? ` · ${String(g.poNo)}` : ''}{g.materialLabels ? ` · ${String(g.materialLabels)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Supplier's bill number" help="As printed on their invoice; it goes on the ITC register.">
              <Input value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
            </Field>
            <Field label="Bill date">
              <Input type="date" max={todayLocal()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Input tax credit" help="Untick for a blocked credit (section 17(5)); its GST then stays out of the ITC register and GSTR-3B.">
              <label className="mn-ma-check">
                <input type="checkbox" checked={itcEligible} onChange={(e) => setItcEligible(e.target.checked)} />
                <span>{itcEligible ? 'Claimable' : 'Blocked credit'}</span>
              </label>
            </Field>
            <div className="mn-vb-form-submit">
              <Button type="submit" loading={busy} icon={<FileText size={14} />} disabled={!grnId}>Raise the bill</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Bills <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Matched means quantity and rate agree with the order and receipt within tolerance.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Bill</span>
              <span>Supplier</span>
              <span>Materials</span>
              <span className="is-num">Amount</span>
              <span>Match</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const id = String(r.id);
              const status = String(r.status);
              const outstanding = num(r.outstandingAmount);
              const match = String(r.matchStatus ?? 'unmatched');
              return (
                <div key={id} className={`mn-ord-row mn-ord-row--acts mn-vb-row${stage === 'cancelled' ? ' is-void' : ''}`} data-tone={match === 'over_tolerance' && status === 'draft' ? 'danger' : toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.billNo ?? '')}</span>
                    <span className="mn-ord-meta">{formatDate(r.billDate ?? r.createdAt)}{r.supplierBillNo ? <><span className="mn-ord-dot" aria-hidden>·</span>their no. {String(r.supplierBillNo)}</> : null}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.supplierName ?? 'Supplier not set')}</span>
                    <span className="mn-ord-meta">{[r.poNo, r.grnNo].filter(Boolean).map(String).join(' · ') || 'No order or receipt'}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{r.materialLabels ? String(r.materialLabels) : <span className="mn-ord-meta">No lines</span>}</span>
                    <span className="mn-ord-meta">{num(r.itemCount)} {num(r.itemCount) === 1 ? 'line' : 'lines'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.totalAmount)}</span>
                    <span className={`mn-ord-meta${status === 'approved' && outstanding > 0.001 ? ' mn-vb-owed' : ''}`}>{status === 'approved' ? (outstanding > 0.001 ? `${money(outstanding)} still owed` : 'Settled') : `${money(r.taxableAmount)} + ${money(r.taxAmount)} GST`}</span>
                  </div>
                  <div className="mn-vb-match" data-tone={match === 'matched' ? 'success' : match === 'over_tolerance' ? 'danger' : 'neutral'}>
                    <span className="mn-ord-when-d">{match === 'matched' ? 'Matched' : match === 'over_tolerance' ? 'Does not match' : 'Not matched'}</span>
                    <span className="mn-ord-meta">{r.itcEligible === false ? 'Blocked credit · no ITC' : 'ITC claimable'}</span>
                  </div>
                  <div className="mn-ord-status">
                    <StatusBadge status={status === 'approved' ? String(r.paymentStatus ?? 'unpaid') : status} />
                    {r.itcEligible === false ? <Badge tone="warning">no ITC</Badge> : null}
                  </div>
                  <div className="mn-ord-act mn-vb-acts">
                    {canApprove && status === 'draft' && (
                      <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Approve ${String(r.billNo)}`, message: `${money(r.totalAmount)} becomes owed to ${String(r.supplierName ?? 'the supplier')}${match === 'over_tolerance' ? '. This bill does NOT match the order and receipt within tolerance; approving overrides the match and is recorded' : ''}. Its GST${r.itcEligible === false ? ' stays out of' : ' goes into'} the input credit register.`, confirmLabel: match === 'over_tolerance' ? 'Approve anyway' : 'Approve', danger: match === 'over_tolerance' }))) return;
                        act(() => purchaseApi.approveBill(id), `${String(r.billNo)} approved; ${money(r.totalAmount)} is now owed to ${String(r.supplierName ?? 'the supplier')}.`);
                      }}>Approve</Button>
                    )}
                    {canPay && status === 'approved' && outstanding > 0.001 && (
                      <Button size="sm" variant="secondary" icon={<Landmark size={14} />} disabled={busy} onClick={() => pay(r)}>Pay</Button>
                    )}
                    {canApprove && status === 'draft' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Cancel ${String(r.billNo)}`, message: 'The bill is withdrawn and the receipt can be billed again. This cannot be undone.', confirmLabel: 'Cancel bill', danger: true }))) return;
                        act(() => purchaseApi.cancelBill(id), `${String(r.billNo)} cancelled.`);
                      }}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No bills ${labelOf(filter)}` : 'No vendor bills yet'}
            description={filter ? 'Press the chip again to see every bill.' : canCreate ? 'When the supplier\'s invoice arrives, press New bill and pick the posted goods receipt it is for; the lines and rates come from the order.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all bills</Button> : canCreate ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>New bill</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="bills" hint="the purchase register (Purchase › Reports)" />
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Landmark size={16} aria-hidden /> Payments to suppliers <span className="mn-board-card-count">{payments.length}</span></span>}
        actions={<span className="mn-ord-how">{loaded ? `${moneyShort(paidOut)} paid out` : ''}</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : payments.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts mn-vb-pay-cols" aria-hidden>
              <span>Payment</span>
              <span>To</span>
              <span>Against</span>
              <span className="is-num">Amount</span>
              <span>Status</span>
              <span />
            </div>
            {payments.map((p) => {
              const pstatus = String(p.status ?? 'posted');
              const unallocated = num(p.unallocatedAmount);
              return (
                <div key={String(p.id)} className={`mn-ord-row mn-ord-row--acts mn-vb-pay-row${pstatus === 'reversed' ? ' is-void' : ''}`} data-tone={pstatus === 'reversed' ? 'danger' : unallocated > 0.001 ? 'info' : 'success'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(p.paymentNo)}</span>
                    <span className="mn-ord-meta">{formatDate(p.paymentDate ?? p.createdAt)}<span className="mn-ord-dot" aria-hidden>·</span>{modeOf(p.paymentMode)}{p.bankReference ? ` · ${String(p.bankReference)}` : ''}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(p.supplierName ?? '—')}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{p.billNos ? String(p.billNos) : <span className="mn-ord-meta">No bill yet</span>}</span>
                    <span className="mn-ord-meta">{unallocated > 0.001 ? `${money(unallocated)} not yet against a bill` : `${money(p.allocatedAmount)} applied`}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(p.amount)}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={pstatus} /></div>
                  <div className="mn-ord-act mn-vb-acts">
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/vendor-payments/${String(p.id)}/pdf`, String(p.paymentNo ?? '')).catch((e) => setError(String(e)))}>Print</Button>
                    {canPay && pstatus === 'posted' && (
                      <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} disabled={busy} onClick={() => reverse(p)}>Reverse</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No payments yet" description="Press Pay on an approved bill to record what was paid; it appears here with the bill it settled." />
        )}
        <ListCap shown={payments.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="payments" />
      </Card>
    </div>
  );
}
