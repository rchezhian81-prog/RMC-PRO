'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, Factory, History, Lock, MapPin, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { ordersApi, type Row } from '../../../../lib/api';
import { money } from '../../../../lib/money';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge, StatusBadge, statusTone } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { StatCard } from '../../../../components/ui/StatCard';
import { Field, Input } from '../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../components/ui/States';
import { AlertSurface } from '../../../../components/ui/AlertSurface';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Order detail — one order from booking to the last pour.
 *
 * The header says who, where, which plant and when; the actions sit beside
 * it. A KPI strip and a progress bar show how much of the order is made and
 * delivered. Below, two columns: the lines, pour schedule and status timeline
 * on the left; money (tax summary, return billing, credit holds) and the
 * special instructions on the right. Same layout in both skins.
 */

const money2 = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

const RETURN_BILLING_OPTIONS = [
  { value: 'net', label: 'Net delivered (bill poured only)' },
  { value: 'gross', label: 'Gross loaded (bill full load)' },
  { value: 'net_plus_fee', label: 'Net + return charge' },
];
const RETURN_BILLING_LABELS: Record<string, string> = Object.fromEntries(
  RETURN_BILLING_OPTIONS.map((o) => [o.value, o.label]),
);

/** Human wording for a status-history action. */
function actionLabel(action: string): string {
  const map: Record<string, string> = {
    create: 'Order drafted',
    confirm: 'Confirmed',
    cancel: 'Cancelled',
    credit_hold: 'Placed on credit hold',
    credit_approve: 'Credit approved',
    credit_reject: 'Credit rejected',
    release: 'Released from hold',
  };
  const a = String(action || '');
  return map[a] ?? a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { prompt } = useConfirm();
  const [o, setO] = useState<Row | null>(null);
  const [credit, setCredit] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState({ slotDate: '', startTime: '', quantityM3: '', truckSpacingMinutes: '', pumpRequired: false });

  const load = useCallback(async () => {
    const order = await ordersApi.get(id);
    setO(order);
    if (order.orderStatus === 'draft') {
      setCredit(await ordersApi.creditCheck(id).catch(() => null));
    } else {
      setCredit(null);
    }
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  // Required slump is the customer's workability spec for the pour; it flows
  // onto the delivery challan. Kept as free text so a range (e.g. 100-120) or a
  // single target both fit.
  async function editSlump(it: Row) {
    const v = await prompt({
      title: 'Required slump',
      message: `Grade ${String(it.gradeLabel ?? '')} — target workability, printed on the delivery challan.`,
      label: 'Slump (mm)',
      placeholder: 'e.g. 100 or 100-120',
      defaultValue: it.slumpRequired ? String(it.slumpRequired) : '',
    });
    if (v === null) return;
    await run(() => ordersApi.setLineSlump(id, String(it.id), v), 'Slump updated');
  }

  async function editReturnBilling() {
    const policy = await prompt({
      title: 'Returned-concrete billing',
      message: 'How a short pour / returned load is billed for this order.',
      label: 'Policy',
      options: RETURN_BILLING_OPTIONS,
      defaultValue: String(o?.returnBillingPolicy ?? 'net'),
    });
    if (policy === null) return;
    let feePerM3: number | undefined;
    if (policy === 'net_plus_fee') {
      const fee = await prompt({
        title: 'Return charge',
        message: 'Charge per returned m³ (added as a separate invoice line).',
        label: 'Fee (₹/m³)',
        defaultValue: o?.returnFeePerM3 ? String(o.returnFeePerM3) : '',
      });
      if (fee === null) return;
      feePerM3 = Number(fee) || 0;
    }
    await run(() => ordersApi.setReturnBilling(id, policy, feePerM3), 'Return billing updated');
  }

  async function addSlot(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await ordersApi.addPourSlot(id, {
        slotDate: slot.slotDate,
        startTime: slot.startTime || undefined,
        quantityM3: Number(slot.quantityM3 || 0),
        truckSpacingMinutes: slot.truckSpacingMinutes ? Number(slot.truckSpacingMinutes) : undefined,
        pumpRequired: slot.pumpRequired,
      });
      setSlot({ slotDate: '', startTime: '', quantityM3: '', truckSpacingMinutes: '', pumpRequired: false });
    }, 'Pour slot added');
  }

  if (!o) return error ? <ErrorState message={error} /> : <Loading label="Loading order…" />;
  const items = (o.items as Row[]) ?? [];
  const history = (o.history as Row[]) ?? [];
  const holds = (o.creditHolds as Row[]) ?? [];
  const slots = (o.pourSlots as Row[]) ?? [];
  const ps = (o.pourSummary as Row | undefined) ?? ({} as Row);
  const q = (o.quantities as Row | undefined) ?? ({} as Row);
  const tax = o.taxSummary as Row | undefined;
  const status = String(o.orderStatus);
  const ordered = num(q.orderedM3 ?? ps.ordered);
  const delivered = num(q.deliveredM3 ?? ps.delivered);
  const onRoad = num(q.pendingDeliveryM3 ?? ps.pendingDelivery);
  const batched = num(q.batchedM3 ?? ps.batched);
  const balance = num(q.balanceM3 ?? Math.max(ordered - delivered, 0));
  const pct = (v: number) => (ordered > 0 ? Math.max(0, Math.min(100, (v / ordered) * 100)) : 0);
  const done = status === 'confirmed' && ordered > 0 && balance <= 0;
  const chargesOf = (it: Row) => num(it.transportCharge) + num(it.pumpCharge) + num(it.waitingCharge);

  return (
    <div className="mn-od">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/orders" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Orders</Link>
          <h1>
            {String(o.orderNo)}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              <Badge tone={statusTone(String(o.creditStatus ?? ''))}>credit {String(o.creditStatus ?? '').replace(/_/g, ' ')}</Badge>
              {done && <Badge tone="success" icon={<CheckCircle2 size={12} />}>fully delivered</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who">{String(o.customerName ?? 'Customer not set')}</span>
            {o.siteName ? <span className="mn-od-fact"><MapPin size={13} aria-hidden /> {String(o.siteName)}</span> : null}
            {o.plantName ? <span className="mn-od-fact"><Factory size={13} aria-hidden /> {String(o.plantName)}</span> : null}
            <span className="mn-od-fact"><ClipboardList size={13} aria-hidden /> Ordered {formatDate(o.orderDate)}</span>
            <span className="mn-od-fact"><CalendarClock size={13} aria-hidden /> {o.requiredDatetime ? `Needed ${formatDateTime(o.requiredDatetime)}` : 'No pour date yet'}</span>
            <span className="mn-od-fact">{String(o.pricingSource) === 'rate_contract' ? 'Rate contract' : 'Quotation'} pricing · {String(o.pricingType) === 'credit' ? 'on credit' : 'cash'}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          {status === 'draft' && (
            <Button onClick={() => run(() => ordersApi.confirm(id), 'Order processed')} loading={busy} icon={<CheckCircle2 size={14} />}>Confirm order</Button>
          )}
          {status === 'credit_hold' && (
            <Link href="/app/credit-holds" className="mn-ord-link"><Button variant="secondary" icon={<Lock size={14} />}>Open credit holds</Button></Link>
          )}
          {status !== 'cancelled' && (
            <Button
              variant={status === 'draft' ? 'ghost' : 'secondary'}
              icon={<XCircle size={14} />}
              onClick={() =>
                run(async () => {
                  const reason = await prompt({ title: 'Cancel order', label: 'Cancel reason', defaultValue: '' });
                  if (reason !== null) await ordersApi.cancel(id, reason);
                }, 'Order cancelled')
              }
            >
              Cancel order
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => run(async () => undefined)} loading={busy}>Refresh</Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <AlertSurface tone="success">{msg}</AlertSurface>}

      {status === 'credit_hold' && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <ShieldAlert size={16} aria-hidden />
          <span><strong>Awaiting credit approval.</strong> This booking took the customer over their limit. Approve or reject it in <Link href="/app/credit-holds">Credit Holds</Link>; nothing is batched until then.</span>
        </div>
      )}
      {status === 'cancelled' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <XCircle size={16} aria-hidden />
          <span><strong>Cancelled.</strong> {o.cancelledReason ? String(o.cancelledReason) : 'No reason recorded.'}</span>
        </div>
      )}
      {status === 'draft' && (
        <div className="mn-ord-note" role="status">
          <ClipboardList size={16} aria-hidden />
          <span><strong>Draft.</strong> Check the lines and the pour date, then confirm to book production. Credit is checked at confirmation; an over-limit booking stops on credit hold.</span>
        </div>
      )}

      {/* KPI strip + progress */}
      <div className="mn-od-kpis">
        <StatCard label="Order value (incl. GST)" value={money(o.estimatedOrderValueInclGst ?? o.estimatedOrderValue)} />
        <StatCard label="Ordered m³" value={qty(ordered)} />
        <StatCard label="Batched m³" value={qty(batched)} tone={batched > 0 ? 'info' : 'neutral'} />
        <StatCard label="Delivered m³" value={qty(delivered)} tone={delivered > 0 ? 'success' : 'neutral'} />
        <StatCard label="On the road m³" value={qty(onRoad)} tone={onRoad > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Balance to pour m³" value={qty(balance)} tone={balance > 0 && status === 'confirmed' ? 'warning' : 'neutral'} />
      </div>
      {ordered > 0 && (
        <div className="mn-od-progress" aria-label="Delivery progress">
          <div className="mn-od-bar" role="img" aria-label={`${qty(delivered)} of ${qty(ordered)} m³ delivered`}>
            <span className="mn-od-bar-seg mn-od-bar-seg--done" style={{ width: `${pct(delivered)}%` }} />
            <span className="mn-od-bar-seg mn-od-bar-seg--road" style={{ width: `${pct(onRoad)}%` }} />
          </div>
          <div className="mn-od-legend">
            <span><i className="mn-od-key mn-od-key--done" /> Delivered {qty(delivered)} m³</span>
            <span><i className="mn-od-key mn-od-key--road" /> On the road {qty(onRoad)} m³</span>
            <span><i className="mn-od-key" /> Still to pour {qty(balance)} m³</span>
            <span className="mn-od-legend-pct">{Math.round(pct(delivered))}% delivered</span>
          </div>
        </div>
      )}

      {credit && (
        <Card title={<span className="mn-board-card-title"><ShieldAlert size={16} aria-hidden /> Credit check at booking</span>}>
          {credit.enforced ? (
            <div className="mn-od-credit">
              <div className="mn-od-credit-grid">
                <StatCard label="Credit limit" value={money(credit.creditLimit)} />
                <StatCard label="Outstanding now" value={money(credit.outstandingBefore)} />
                <StatCard label="This order" value={money(credit.requestedAmount)} />
                <StatCard label="Exposure after" value={money(credit.exposureAfter)} tone={credit.withinLimit ? 'success' : 'warning'} />
              </div>
              {(() => {
                const limit = num(credit.creditLimit);
                const before = Math.max(0, num(credit.outstandingBefore));
                const req = num(credit.requestedAmount);
                const scale = Math.max(limit, before + req, 1);
                const w = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
                return (
                  <div className="mn-od-meter" data-tone={credit.withinLimit ? 'success' : 'warning'}>
                    <div className="mn-od-meter-bar">
                      <span className="mn-od-meter-seg mn-od-meter-seg--before" style={{ width: w(before) }} />
                      <span className="mn-od-meter-seg mn-od-meter-seg--req" style={{ width: w(req) }} />
                      <span className="mn-od-meter-limit" style={{ left: w(limit) }} title="Credit limit" />
                    </div>
                    <div className="mn-od-legend">
                      <span><i className="mn-od-key mn-od-key--before" /> Already outstanding</span>
                      <span><i className="mn-od-key mn-od-key--req" /> This order</span>
                      <span className="mn-od-legend-pct">{credit.withinLimit ? `Within limit · ${money(credit.availableBefore)} available before this order` : `Exceeds the limit by ${money(num(credit.exposureAfter) - limit)} — confirming will stop on credit hold`}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="mn-board-form-hint" style={{ margin: 0 }}>No credit limit configured for this customer — credit control is not enforced.</p>
          )}
        </Card>
      )}

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> Lines <span className="mn-board-card-count">{items.length}</span></span>} padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Grade</Th>
                  <Th numeric>Ordered m³</Th>
                  <Th numeric>Batched</Th>
                  <Th numeric>Delivered</Th>
                  <Th numeric>Balance</Th>
                  <Th numeric>Rate/m³</Th>
                  <Th>Line</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const lq = num(it.quantityM3);
                  const ld = it.deliveredM3 == null ? null : num(it.deliveredM3);
                  const lp = lq > 0 && ld != null ? Math.max(0, Math.min(100, (ld / lq) * 100)) : 0;
                  return (
                    <tr key={String(it.id)}>
                      <Td>
                        <span className="mn-od-grade">{String(it.gradeLabel ?? '')}</span>
                        {ld != null && lq > 0 && (
                          <span className="mn-od-linebar" aria-hidden><span style={{ width: `${lp}%` }} /></span>
                        )}
                        <button type="button" className="mn-od-slump" onClick={() => editSlump(it)} title="Required slump, printed on the delivery challan">
                          {it.slumpRequired ? `Slump ${String(it.slumpRequired)} mm` : 'Set slump'}
                        </button>
                      </Td>
                      <Td numeric className="mn-od-num">{qty(lq)}</Td>
                      <Td numeric title="Confirmed batch tickets for this grade">{it.batchedM3 == null ? '—' : qty(it.batchedM3)}</Td>
                      <Td numeric title="Delivered challans for this grade, net of returns">{ld == null ? '—' : qty(ld)}</Td>
                      <Td numeric className="mn-od-num" style={{ color: num(it.balanceM3) > 0 ? 'var(--mn-warning)' : undefined }}>{it.balanceM3 == null ? '—' : qty(it.balanceM3)}</Td>
                      <Td numeric>
                        <span className="mn-od-num">{money2(it.ratePerM3)}</span>
                        {chargesOf(it) > 0 && (
                          <span className="mn-od-rate-meta" title={`Transport ${money2(it.transportCharge)} · Pump ${money2(it.pumpCharge)} · Waiting ${money2(it.waitingCharge)}`}>+ {money2(chargesOf(it))} charges</span>
                        )}
                      </Td>
                      <Td>{it.lineStatus ? <StatusBadge status={String(it.lineStatus)} /> : '—'}</Td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr>
                    <Td colSpan={7} style={{ color: 'var(--mn-muted)' }}>No lines.</Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <div className="mn-od-lines-foot">
              <span className="mn-ord-meta">Charges per m³ are transport + pump + waiting; hover a figure for the split.</span>
              <span className="mn-od-lines-total">Estimated value <strong>{money2(o.estimatedOrderValue)}</strong> <span className="mn-ord-meta">ex-GST</span></span>
            </div>
          </Card>

          <Card title={<span className="mn-board-card-title"><CalendarClock size={16} aria-hidden /> Pour schedule <span className="mn-board-card-count">{slots.length}</span></span>} padded={false}>
            <div className="mn-od-slot-sum">
              <span><strong>{qty(ps.scheduled)}</strong> m³ scheduled</span>
              <span className="mn-ord-dot" aria-hidden>·</span>
              <span><strong>{qty(ps.unscheduled)}</strong> m³ not yet scheduled</span>
              <span className="mn-ord-dot" aria-hidden>·</span>
              <span><strong>{qty(delivered)}</strong> m³ delivered</span>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th numeric>#</Th><Th>Date</Th><Th>Start</Th><Th numeric>Qty m³</Th>
                  <Th numeric>Truck spacing</Th><Th>Pump</Th><Th>Status</Th><Th />
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={String(s.id)}>
                    <Td numeric>{i + 1}</Td>
                    <Td className="mn-od-num">{formatDate(s.slotDate)}</Td>
                    <Td>{String(s.startTime ?? '—')}</Td>
                    <Td numeric className="mn-od-num">{qty(s.quantityM3)}</Td>
                    <Td numeric>{s.truckSpacingMinutes == null ? '—' : `${String(s.truckSpacingMinutes)} min`}</Td>
                    <Td>{s.pumpRequired ? <Badge tone="info">pump</Badge> : <span className="mn-ord-meta">no pump</span>}</Td>
                    <Td><StatusBadge status={String(s.status ?? '')} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <Button variant="ghost" size="sm" onClick={() => run(() => ordersApi.removePourSlot(id, String(s.id)), 'Slot removed')}>Remove</Button>
                    </Td>
                  </tr>
                ))}
                {!slots.length && (
                  <tr><Td colSpan={8} style={{ color: 'var(--mn-muted)' }}>No slots yet. Add the first pour below so the plant can plan trucks.</Td></tr>
                )}
              </tbody>
            </Table>
            <form onSubmit={addSlot} className="mn-od-slot-form">
              <Field label="Date"><Input type="date" value={slot.slotDate} onChange={(e) => setSlot({ ...slot, slotDate: e.target.value })} required /></Field>
              <Field label="Start time"><Input type="time" value={slot.startTime} onChange={(e) => setSlot({ ...slot, startTime: e.target.value })} /></Field>
              <Field label="Qty m³"><Input type="number" step="any" value={slot.quantityM3} onChange={(e) => setSlot({ ...slot, quantityM3: e.target.value })} required /></Field>
              <Field label="Truck spacing (min)"><Input type="number" value={slot.truckSpacingMinutes} onChange={(e) => setSlot({ ...slot, truckSpacingMinutes: e.target.value })} /></Field>
              <label className="mn-od-check">
                <input type="checkbox" checked={slot.pumpRequired} onChange={(e) => setSlot({ ...slot, pumpRequired: e.target.checked })} /> Pump needed
              </label>
              <div className="mn-od-slot-submit"><Button type="submit" variant="secondary">Add slot</Button></div>
            </form>
          </Card>

          <Card title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Status history</span>}>
            {history.length ? (
              <ol className="mn-od-tl">
                {[...history].reverse().map((h) => (
                  <li key={String(h.id)} data-tone={statusTone(String(h.toStatus ?? ''))}>
                    <span className="mn-od-tl-dot" aria-hidden />
                    <div className="mn-od-tl-body">
                      <span className="mn-od-tl-title">{actionLabel(String(h.action))}</span>
                      <span className="mn-ord-meta">
                        {formatDateTime(h.createdAt)}
                        <span className="mn-ord-dot" aria-hidden>·</span>
                        {String(h.fromStatus ?? 'new').replace(/_/g, ' ')} → {String(h.toStatus ?? '').replace(/_/g, ' ')}
                      </span>
                      {h.note ? <span className="mn-od-tl-note">{String(h.note)}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mn-board-form-hint" style={{ margin: 0 }}>No history yet.</p>
            )}
          </Card>
        </div>

        <aside className="mn-od-side">
          {tax && (
            <Card title="Money">
              <dl className="mn-od-money">
                <div><dt>Taxable value</dt><dd>{money2(tax.taxable)}</dd></div>
                {num(tax.cgst) > 0 && <div><dt>CGST</dt><dd>{money2(tax.cgst)}</dd></div>}
                {num(tax.cgst) > 0 && <div><dt>SGST</dt><dd>{money2(tax.sgst)}</dd></div>}
                {num(tax.igst) > 0 && <div><dt>IGST</dt><dd>{money2(tax.igst)}</dd></div>}
                <div className="mn-od-money-total"><dt>Total{tax.isInterstate ? ' (inter-state)' : ''}</dt><dd>{money2(tax.total)}</dd></div>
              </dl>
            </Card>
          )}

          <Card title="Returned concrete">
            <p className="mn-board-form-hint" style={{ margin: '0 0 10px' }}>How a short pour or returned load is billed when this order&rsquo;s challans are invoiced.</p>
            <div className="mn-od-policy">
              <span className="mn-od-policy-v">{RETURN_BILLING_LABELS[String(o.returnBillingPolicy ?? 'net')] ?? String(o.returnBillingPolicy ?? 'net')}</span>
              {String(o.returnBillingPolicy) === 'net_plus_fee' && <span className="mn-ord-meta">fee {money2(o.returnFeePerM3)} per m³</span>}
              <Button variant="secondary" size="sm" onClick={() => editReturnBilling()}>Change</Button>
            </div>
          </Card>

          {holds.length > 0 && (
            <Card title={<span className="mn-board-card-title"><Lock size={16} aria-hidden /> Credit holds</span>}>
              <ul className="mn-od-holds">
                {holds.map((h) => (
                  <li key={String(h.id)}>
                    <div className="mn-od-hold-top">
                      <StatusBadge status={String(h.status ?? '')} />
                      <span className="mn-ord-meta">{formatDateTime(h.createdAt)}</span>
                    </div>
                    <dl className="mn-od-money mn-od-money--tight">
                      <div><dt>Requested</dt><dd>{money(h.requestedAmount)}</dd></div>
                      <div><dt>Limit</dt><dd>{money(h.creditLimit)}</dd></div>
                      <div><dt>Exposure after</dt><dd>{money(h.exposureAfter)}</dd></div>
                    </dl>
                    {h.decisionNote ? <span className="mn-od-tl-note">{String(h.decisionNote)}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {o.specialInstructions ? (
            <Card title="Special instructions">
              <p className="mn-od-instr">{String(o.specialInstructions)}</p>
            </Card>
          ) : null}

          <Card title="Source">
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Pricing</dt><dd>{String(o.pricingSource) === 'rate_contract' ? 'Rate contract' : 'Quotation'}</dd></div>
              <div><dt>Terms</dt><dd>{String(o.pricingType) === 'credit' ? 'On credit' : 'Cash'}</dd></div>
              {o.confirmedAt ? <div><dt>Confirmed</dt><dd>{formatDateTime(o.confirmedAt)}</dd></div> : null}
              {o.quotationId ? <div><dt>Quotation</dt><dd><Link href={`/app/sales/quotations/${String(o.quotationId)}`}>Open quotation</Link></dd></div> : null}
              {o.rateContractId ? <div><dt>Contract</dt><dd><Link href={`/app/sales/rate-contracts/${String(o.rateContractId)}`}>Open contract</Link></dd></div> : null}
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
