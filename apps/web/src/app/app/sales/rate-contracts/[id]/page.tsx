'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, FileSignature, FileText, Hourglass, MapPin, Plus, RefreshCw, Send, XCircle } from 'lucide-react';
import { crud, orderDraftsApi, rateContractsApi, type Row } from '../../../../../lib/api';
import { money } from '../../../../../lib/money';
import { formatDate } from '../../../../../lib/format-date';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Form } from '../../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { AlertSurface } from '../../../../../components/ui/AlertSurface';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';

/**
 * Rate contract detail — one contract from draft to the orders under it.
 *
 * The header says who it is with, where, the period and the terms; the
 * stage's own action (submit, approve / reject) sits beside Refresh. Five
 * tiles carry the grades, the rate range, the validity and what has been
 * ordered. Below, two columns: the grade rates with the add / edit form and,
 * once approved, the quantity boxes that book an order draft; the orders
 * already under the contract; and on the right the terms to edit. Same
 * layout in both skins.
 */

const money2 = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const PAYMENT_TERMS = ['Advance (100%)', 'Cash on delivery', 'Credit — 15 days', 'Credit — 30 days', 'Credit — 45 days', 'Credit — 60 days'];

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** A number field at module scope so it keeps the same <input> across renders. */
function Num({ label, v, on, help }: { label: string; v: string; on: (v: string) => void; help?: string }) {
  return (
    <Field label={label} help={help}>
      <Input type="number" step="any" min={0} inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} />
    </Field>
  );
}

export default function RateContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { prompt } = useConfirm();
  const [rc, setRc] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const EMPTY_ITEM = { gradeId: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '', gstRate: '18' };
  const [item, setItem] = useState(EMPTY_ITEM);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [orderQty, setOrderQty] = useState<Record<string, string>>({});
  const [hdr, setHdr] = useState({ validFrom: '', validTo: '', paymentTerms: '', transportTerms: '', pumpTerms: '', remarks: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [full, g, p] = await Promise.all([rateContractsApi.get(id), crud('concrete-grades').list({ active: true }), crud('plants').list({ active: true })]);
    setRc(full);
    setGrades(g);
    setPlants(p);
    setHdr({
      validFrom: String(full.validFrom ?? '').slice(0, 10),
      validTo: String(full.validTo ?? '').slice(0, 10),
      paymentTerms: String(full.paymentTerms ?? ''),
      transportTerms: String(full.transportTerms ?? ''),
      pumpTerms: String(full.pumpTerms ?? ''),
      remarks: String(full.remarks ?? ''),
    });
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const out = await fn();
      await load();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitItem(e: FormEvent) {
    e.preventDefault();
    const g = grades.find((x) => String(x.id) === item.gradeId);
    const body = {
      gradeId: item.gradeId || undefined,
      gradeLabel: g ? String(g.gradeCode) : undefined,
      ratePerM3: Number(item.ratePerM3 || 0),
      transportCharge: Number(item.transportCharge || 0),
      pumpCharge: Number(item.pumpCharge || 0),
      waitingCharge: Number(item.waitingCharge || 0),
      gstRate: Number(item.gstRate || 0),
    };
    await run(async () => {
      if (editingItemId) await rateContractsApi.updateItem(id, editingItemId, body);
      else await rateContractsApi.addItem(id, body);
      setItem(EMPTY_ITEM);
      setEditingItemId(null);
    }, editingItemId ? 'Rate updated' : 'Grade rate added');
  }
  function startEditItem(it: Row) {
    setEditingItemId(String(it.id));
    setItem({
      gradeId: String(it.gradeId ?? ''), ratePerM3: String(num(it.ratePerM3)), transportCharge: String(num(it.transportCharge)),
      pumpCharge: String(num(it.pumpCharge)), waitingCharge: String(num(it.waitingCharge)), gstRate: String(num(it.gstRate) || 18),
    });
  }
  function cancelEditItem() {
    setEditingItemId(null);
    setItem(EMPTY_ITEM);
  }

  async function saveHeader(e: FormEvent) {
    e.preventDefault();
    await run(() => rateContractsApi.update(id, {
      validFrom: hdr.validFrom || null,
      validTo: hdr.validTo || null,
      paymentTerms: hdr.paymentTerms,
      transportTerms: hdr.transportTerms,
      pumpTerms: hdr.pumpTerms,
      remarks: hdr.remarks,
    }), 'Contract details saved');
  }

  const bookOrder = () => run(async () => {
    const lines = ((rc?.items as Row[]) ?? [])
      .map((it) => ({ gradeId: it.gradeId, gradeLabel: it.gradeLabel, quantityM3: Number(orderQty[String(it.id)] || 0) }))
      .filter((l) => l.quantityM3 > 0);
    if (!lines.length) throw new Error('Enter a quantity against at least one grade.');
    const plantId = plants.length > 1
      ? await prompt({
          title: 'Book an order draft',
          label: 'Producing plant',
          message: 'The draft carries the contract rates; confirm it under Orders after the credit check.',
          options: plants.map((p) => ({ value: String(p.id), label: String(p.plantName ?? p.plantCode ?? p.id) })),
          defaultValue: String(plants[0]?.id ?? ''),
          confirmLabel: 'Create order draft',
        })
      : String(plants[0]?.id ?? '');
    if (plantId === null) return;
    const od = await orderDraftsApi.fromRateContract(id, { lines, plantId: plantId || undefined });
    setOrderQty({});
    return `Order draft ${String(od.orderNo)} created at the contract rates. Confirm it under Orders.`;
  });

  if (!rc) return error ? <ErrorState message={error} /> : <Loading label="Loading rate contract…" />;
  const items = (rc.items as Row[]) ?? [];
  const orders = (rc.orders as Row[]) ?? [];
  const status = String(rc.approvalStatus);
  const locked = status === 'approved';
  const to = daysUntil(rc.validTo);
  const from = daysUntil(rc.validFrom);
  const expired = locked && to !== null && to < 0;
  const validity = to === null && from === null ? { label: 'No dates set', tone: locked ? 'warning' as const : 'neutral' as const }
    : to !== null && to < 0 ? { label: to === -1 ? 'Ended yesterday' : `Ended ${-to} days ago`, tone: locked ? 'danger' as const : 'neutral' as const }
    : from !== null && from > 0 ? { label: `Starts in ${from} ${from === 1 ? 'day' : 'days'}`, tone: 'info' as const }
    : to === null ? { label: 'Open-ended', tone: 'neutral' as const }
    : to === 0 ? { label: 'Ends today', tone: 'warning' as const }
    : to <= 30 ? { label: `Ends in ${to} ${to === 1 ? 'day' : 'days'}`, tone: 'warning' as const }
    : { label: `${to} days left`, tone: 'neutral' as const };
  const lineAllIn = (it: Row) => num(it.ratePerM3) + num(it.transportCharge) + num(it.pumpCharge) + num(it.waitingCharge);
  const rates = items.map((it) => num(it.ratePerM3));
  const minRate = rates.length ? Math.min(...rates) : 0;
  const maxRate = rates.length ? Math.max(...rates) : 0;
  const termOptions = rc.paymentTerms && !PAYMENT_TERMS.includes(String(rc.paymentTerms)) ? [String(rc.paymentTerms), ...PAYMENT_TERMS] : PAYMENT_TERMS;
  const bookingM3 = items.reduce((t, it) => t + num(orderQty[String(it.id)]), 0);
  const bookingValue = items.reduce((t, it) => t + num(orderQty[String(it.id)]) * lineAllIn(it), 0);

  return (
    <div className="mn-od mn-rcd">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/sales/rate-contracts" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Rate contracts</Link>
          <h1>
            {String(rc.rateContractNo)}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              {expired && <Badge tone="neutral">expired</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who">{String(rc.customerName ?? 'Customer not set')}</span>
            <span className="mn-od-fact"><MapPin size={13} aria-hidden /> {rc.siteName ? String(rc.siteName) : 'All sites'}</span>
            <span className="mn-od-fact" data-tone={validity.tone}><CalendarClock size={13} aria-hidden /> {rc.validFrom || rc.validTo ? `${rc.validFrom ? formatDate(rc.validFrom) : '…'} → ${rc.validTo ? formatDate(rc.validTo) : '…'}` : 'No dates'} · <span className="mn-qd-validity">{validity.label}</span></span>
            <span className="mn-od-fact">{rc.paymentTerms ? String(rc.paymentTerms) : 'Payment terms not set'}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          {status === 'draft' && <Button icon={<Send size={14} />} onClick={() => run(() => rateContractsApi.submit(id), 'Submitted for approval')} loading={busy} disabled={!items.length}>Submit for approval</Button>}
          {status === 'rejected' && <Button icon={<Send size={14} />} onClick={() => run(() => rateContractsApi.submit(id), 'Re-submitted')} loading={busy}>Re-submit</Button>}
          {status === 'submitted' && <Button icon={<CheckCircle2 size={14} />} onClick={() => run(() => rateContractsApi.approve(id), 'Approved: the rates are locked and orders can be booked under the contract')} loading={busy}>Approve</Button>}
          {status === 'submitted' && <Button variant="secondary" icon={<XCircle size={14} />} onClick={() => run(async () => { const reason = await prompt({ title: 'Reject rate contract', label: 'Why (the salesperson sees this)', defaultValue: '' }); if (reason !== null) await rateContractsApi.reject(id, reason || 'Not accepted'); }, 'Rate contract rejected')}>Reject</Button>}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => run(async () => undefined)} loading={busy}>Refresh</Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <AlertSurface tone="success">{msg}</AlertSurface>}

      {status === 'draft' && (
        <div className="mn-ord-note" role="status">
          <ClipboardList size={16} aria-hidden />
          <span><strong>Draft.</strong> {items.length ? 'Check the rates and the terms, then submit it for approval.' : 'Add the rate for at least one grade below, then submit it for approval.'}</span>
        </div>
      )}
      {status === 'submitted' && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Hourglass size={16} aria-hidden />
          <span><strong>Waiting for approval.</strong> Approve to lock the rates, or reject with a reason so the salesperson can revise them.</span>
        </div>
      )}
      {locked && !expired && (
        <div className="mn-ord-note mn-ord-note--ok" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>In force and locked.</strong> Enter quantities against the grades below to book an order draft at these rates. To change a rate, raise a new contract.</span>
        </div>
      )}
      {expired && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <CalendarClock size={16} aria-hidden />
          <span><strong>Expired.</strong> The period ended on {formatDate(rc.validTo)}. Raise a new contract for the next period; the orders already booked keep these rates.</span>
        </div>
      )}
      {status === 'rejected' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <XCircle size={16} aria-hidden />
          <span><strong>Rejected.</strong> {rc.remarks ? `${String(rc.remarks).replace(/[.\s]+$/, '')}.` : 'No reason recorded.'} Change the rates or the terms, then re-submit.</span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Grades priced" value={items.length} />
        <StatCard label="Rate per m³" value={items.length ? (minRate === maxRate ? money(minRate) : `${money(minRate)} – ${money(maxRate)}`) : '—'} tone="info" />
        <StatCard label="Validity" value={to === null ? '—' : to < 0 ? 'Ended' : `${to} d`} tone={validity.tone === 'info' ? 'neutral' : validity.tone} />
        <StatCard label="Orders booked" value={num(rc.orderCount)} tone={num(rc.orderCount) ? 'success' : 'neutral'} />
        <StatCard label="Ordered value" value={money(rc.orderValue)} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> Grade rates <span className="mn-board-card-count">{items.length}</span></span>} padded={false}>
            <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr>
                    <Th>Grade</Th>
                    <Th numeric>Rate/m³</Th>
                    <Th numeric>All-in/m³</Th>
                    <Th>GST</Th>
                    {locked && !expired && <Th numeric>Book m³</Th>}
                    {!locked && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={String(it.id)} className={editingItemId === String(it.id) ? 'mn-qd-editing' : undefined}>
                      <Td><span className="mn-od-grade">{String(it.gradeLabel ?? '')}</span></Td>
                      <Td numeric>
                        <span className="mn-od-num">{money2(it.ratePerM3)}</span>
                        {lineAllIn(it) - num(it.ratePerM3) > 0 && (
                          <span className="mn-od-rate-meta">+ {[num(it.transportCharge) ? `transport ${money2(it.transportCharge)}` : '', num(it.pumpCharge) ? `pump ${money2(it.pumpCharge)}` : '', num(it.waitingCharge) ? `waiting ${money2(it.waitingCharge)}` : ''].filter(Boolean).join(' · ')}</span>
                        )}
                      </Td>
                      <Td numeric className="mn-od-num">{money2(lineAllIn(it))}</Td>
                      <Td>{it.gstApplicable === false ? <span className="mn-ord-meta">exempt</span> : `${num(it.gstRate)}%`}</Td>
                      {locked && !expired && (
                        <Td numeric>
                          <Input type="number" step="any" min={0} inputMode="decimal" className="mn-rcd-qty" aria-label={`Quantity of ${String(it.gradeLabel ?? '')} to book`} value={orderQty[String(it.id)] ?? ''} onChange={(e) => setOrderQty({ ...orderQty, [String(it.id)]: e.target.value })} />
                        </Td>
                      )}
                      {!locked && (
                        <Td style={{ textAlign: 'right' }}>
                          <span className="mn-ord-act" style={{ display: 'inline-flex', gap: 2 }}>
                            <Button variant="ghost" size="sm" onClick={() => startEditItem(it)}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => run(() => rateContractsApi.deleteItem(id, String(it.id)), 'Grade removed')}>Remove</Button>
                          </span>
                        </Td>
                      )}
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <Td colSpan={locked ? 5 : 5} style={{ color: 'var(--mn-muted)' }}>No grade rates yet. Add the first one below.</Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
            <div className="mn-od-lines-foot">
              <span className="mn-ord-meta">All-in/m³ = rate + transport + pump + waiting, before GST.</span>
              {locked && !expired && bookingM3 > 0 && <span className="mn-od-lines-total">Booking <strong>{qty(bookingM3)} m³</strong> <span className="mn-ord-meta">≈ {money2(bookingValue)} ex-GST</span></span>}
            </div>
            {locked && !expired ? (
              <div className="mn-qd-item-wrap mn-rcd-book">
                <p className="mn-board-form-hint" style={{ margin: '0 0 10px' }}>
                  <strong>Book an order.</strong> Type the cubic metres against each grade above and press the button: an order draft is created at the contract rates for you to confirm under Orders.
                </p>
                <Button icon={<FileText size={14} />} onClick={bookOrder} loading={busy} disabled={bookingM3 <= 0}>Create order draft{bookingM3 > 0 ? ` · ${qty(bookingM3)} m³` : ''}</Button>
              </div>
            ) : !locked ? (
              <div className="mn-qd-item-wrap">
                <p className="mn-board-form-hint" style={{ margin: '0 0 10px' }}>
                  <strong>{editingItemId ? 'Editing a grade rate.' : 'Add a grade rate.'}</strong> All amounts are per m³: <strong>Rate</strong> is the concrete, <strong>Transport</strong> the delivery to site, <strong>Pump</strong> the pumping charge, <strong>Waiting</strong> a truck kept waiting. Leave a charge at 0 if it does not apply.
                </p>
                <Form onSubmit={submitItem} className="mn-qd-item-form">
                  <Field label="Grade">
                    <Select value={item.gradeId} onChange={(e) => setItem({ ...item, gradeId: e.target.value })} required>
                      <option value="">Choose…</option>
                      {grades.map((g) => (
                        <option key={String(g.id)} value={String(g.id)}>{String(g.gradeCode)}{g.gradeName && g.gradeName !== g.gradeCode ? ` · ${String(g.gradeName)}` : ''}</option>
                      ))}
                    </Select>
                  </Field>
                  <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
                  <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
                  <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
                  <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
                  <Num label="GST %" v={item.gstRate} on={(v) => setItem({ ...item, gstRate: v })} />
                  <div className="mn-qd-item-submit">
                    <Button type="submit" variant={editingItemId ? 'primary' : 'secondary'} icon={editingItemId ? undefined : <Plus size={14} />}>{editingItemId ? 'Update rate' : 'Add rate'}</Button>
                    {editingItemId && <Button type="button" variant="ghost" onClick={cancelEditItem}>Cancel</Button>}
                  </div>
                </Form>
              </div>
            ) : (
              <p className="mn-board-form-hint mn-qd-locked">This contract has ended; its rates are kept for the record. Raise a new contract for the next period.</p>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Orders under this contract <span className="mn-board-card-count">{orders.length}</span></span>} padded={false}>
            {orders.length ? (
              <div className="mn-id-scroll">
                <Table>
                  <thead>
                    <tr>
                      <Th>Order</Th>
                      <Th>Grades</Th>
                      <Th numeric>Quantity</Th>
                      <Th numeric>Value</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={String(o.id)}>
                        <Td>
                          <Link href={`/app/orders/${String(o.id)}`} className="mn-id-link mn-od-num">{String(o.orderNo)}</Link>
                          <span className="mn-od-rate-meta">{o.orderDate ? formatDate(o.orderDate) : ''}</span>
                        </Td>
                        <Td>{String(o.gradeLabels ?? '—')}</Td>
                        <Td numeric className="mn-od-num">{qty(o.quantityM3)} m³</Td>
                        <Td numeric className="mn-od-num">{money(o.estimatedOrderValue)}</Td>
                        <Td><StatusBadge status={String(o.orderStatus ?? '')} /></Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="mn-ir-total">
                      <Td colSpan={2}>{num(rc.orderCount)} {num(rc.orderCount) === 1 ? 'order' : 'orders'} (cancelled ones not counted)</Td>
                      <Td numeric>{qty(rc.orderedM3)} m³</Td>
                      <Td numeric><span className="mn-ir-total-value">{money(rc.orderValue)}</span></Td>
                      <Td />
                    </tr>
                  </tfoot>
                </Table>
              </div>
            ) : (
              <p className="mn-board-form-hint mn-qd-locked">{locked && !expired ? 'No orders booked yet. Enter quantities against the grades above to book the first one.' : 'No orders were booked under this contract.'}</p>
            )}
          </Card>
        </div>

        <aside className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><FileSignature size={16} aria-hidden /> Terms</span>}>
            {!locked ? (
              <Form onSubmit={saveHeader} className="mn-qd-details">
                <Field label="Valid from">
                  <Input type="date" value={hdr.validFrom} onChange={(e) => setHdr({ ...hdr, validFrom: e.target.value })} />
                </Field>
                <Field label="Valid to">
                  <Input type="date" min={hdr.validFrom || undefined} value={hdr.validTo} onChange={(e) => setHdr({ ...hdr, validTo: e.target.value })} />
                </Field>
                <Field label="Payment terms">
                  <Select value={hdr.paymentTerms} onChange={(e) => setHdr({ ...hdr, paymentTerms: e.target.value })}>
                    <option value="">—</option>
                    {termOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Field>
                <Field label="Transport terms" help="e.g. up to 15 km included, ₹40/km beyond.">
                  <Input value={hdr.transportTerms} onChange={(e) => setHdr({ ...hdr, transportTerms: e.target.value })} />
                </Field>
                <Field label="Pump terms" help="e.g. ₹350/m³ when pumped; minimum 20 m³.">
                  <Input value={hdr.pumpTerms} onChange={(e) => setHdr({ ...hdr, pumpTerms: e.target.value })} />
                </Field>
                <Field label="Remarks">
                  <Input value={hdr.remarks} onChange={(e) => setHdr({ ...hdr, remarks: e.target.value })} />
                </Field>
                <div className="mn-qd-details-submit"><Button type="submit" variant="secondary" loading={busy}>Save terms</Button></div>
              </Form>
            ) : (
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Customer</dt><dd>{String(rc.customerName ?? '—')}</dd></div>
                <div><dt>Site</dt><dd>{rc.siteName ? String(rc.siteName) : 'All sites'}</dd></div>
                <div><dt>Valid from</dt><dd>{rc.validFrom ? formatDate(rc.validFrom) : '—'}</dd></div>
                <div><dt>Valid to</dt><dd>{rc.validTo ? formatDate(rc.validTo) : '—'}</dd></div>
                <div><dt>Payment terms</dt><dd>{String(rc.paymentTerms ?? '—')}</dd></div>
                <div><dt>Transport terms</dt><dd>{String(rc.transportTerms ?? '—')}</dd></div>
                <div><dt>Pump terms</dt><dd>{String(rc.pumpTerms ?? '—')}</dd></div>
                {rc.remarks ? <div><dt>Remarks</dt><dd>{String(rc.remarks)}</dd></div> : null}
              </dl>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
