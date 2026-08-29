'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { StatCard } from '../../../../components/ui/StatCard';
import { Field, Input } from '../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

const RETURN_BILLING_OPTIONS = [
  { value: 'net', label: 'Net delivered (bill poured only)' },
  { value: 'gross', label: 'Gross loaded (bill full load)' },
  { value: 'net_plus_fee', label: 'Net + return charge' },
];
const RETURN_BILLING_LABELS: Record<string, string> = Object.fromEntries(
  RETURN_BILLING_OPTIONS.map((o) => [o.value, o.label]),
);

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { prompt } = useConfirm();
  const [o, setO] = useState<Row | null>(null);
  const [credit, setCredit] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
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
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
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
  const status = String(o.orderStatus);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/orders')}>
          Orders
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(o.orderNo)}</h1>
        <StatusBadge status={status} />
        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>credit {String(o.creditStatus)}</span>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {credit && (
        <Card title="Credit check at booking">
          {credit.enforced ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              <StatCard label="Credit limit" value={money(credit.creditLimit)} />
              <StatCard label="Outstanding" value={money(credit.outstandingBefore)} />
              <StatCard label="This order" value={money(credit.requestedAmount)} />
              <StatCard label="Exposure after" value={money(credit.exposureAfter)} />
              <StatCard
                label="Result"
                value={credit.withinLimit ? 'Within limit' : 'Exceeds limit'}
                tone={credit.withinLimit ? 'success' : 'warning'}
              />
            </div>
          ) : (
            <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
              No credit limit configured for this customer — credit control not enforced.
            </p>
          )}
        </Card>
      )}

      <Card title="Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {status === 'draft' && (
            <Button onClick={() => run(() => ordersApi.confirm(id), 'Order processed')}>Confirm order</Button>
          )}
          {status !== 'cancelled' && (
            <Button
              variant="secondary"
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
          {status === 'credit_hold' && (
            <span style={{ color: 'var(--mn-warning)', fontSize: 13 }}>Awaiting credit approval — see Credit Holds.</span>
          )}
        </div>
      </Card>

      <Card title="Lines" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Grade</Th>
              <Th numeric>Qty m³</Th>
              <Th numeric>Rate/m³</Th>
              <Th numeric>Transport</Th>
              <Th numeric>Pump</Th>
              <Th numeric>Waiting</Th>
              <Th>Slump</Th>
              <Th>Line</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <Td>{String(it.gradeLabel ?? '')}</Td>
                <Td numeric>{qty(it.quantityM3)}</Td>
                <Td numeric>{money(it.ratePerM3)}</Td>
                <Td numeric>{money(it.transportCharge)}</Td>
                <Td numeric>{money(it.pumpCharge)}</Td>
                <Td numeric>{money(it.waitingCharge)}</Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => editSlump(it)}>
                    {it.slumpRequired ? `${String(it.slumpRequired)} mm` : 'Set'}
                  </Button>
                </Td>
                <Td>{String(it.lineStatus ?? '')}</Td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <Td colSpan={8} style={{ color: 'var(--mn-muted)' }}>No lines.</Td>
              </tr>
            )}
          </tbody>
        </Table>
        <p style={{ textAlign: 'right', margin: '12px 16px', fontWeight: 700, fontFamily: 'var(--mn-font-display)' }}>
          Estimated value: {money(o.estimatedOrderValue)}
        </p>
      </Card>

      <Card title="Returned-concrete billing">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 10px', maxWidth: 720 }}>
          How a short pour / returned load is billed when this order&rsquo;s challans are invoiced.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{RETURN_BILLING_LABELS[String(o.returnBillingPolicy ?? 'net')] ?? String(o.returnBillingPolicy ?? 'net')}</span>
          {String(o.returnBillingPolicy) === 'net_plus_fee' && (
            <span style={{ color: 'var(--mn-muted)', fontSize: 13 }}>fee ₹{money(o.returnFeePerM3)}/m³</span>
          )}
          <Button variant="secondary" size="sm" onClick={() => editReturnBilling()}>Change</Button>
        </div>
      </Card>

      {(() => {
        const s = o.taxSummary as Row | undefined;
        if (!s) return null;
        // Label yields (ellipsis) when the row is tight so the ₹ value is never
        // clipped on narrow phones; space-between keeps them apart on wide cards.
        const row = (label: string, value: unknown, strong = false) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '3px 0', fontWeight: strong ? 700 : 400, color: strong ? 'inherit' : 'var(--mn-muted)' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <span style={{ whiteSpace: 'nowrap' }}>{money(value)}</span>
          </div>
        );
        return (
          <Card style={{ maxWidth: 380, marginLeft: 'auto', width: '100%' }}>
            {row('Taxable', s.taxable)}
            {Number(s.cgst) > 0 && row('CGST', s.cgst)}
            {Number(s.cgst) > 0 && row('SGST', s.sgst)}
            {Number(s.igst) > 0 && row('IGST', s.igst)}
            <div style={{ borderTop: '1px solid var(--mn-border)', margin: '8px 0', paddingTop: 8 }}>
              {row(`Total${s.isInterstate ? ' (inter-state)' : ''}`, s.total, true)}
            </div>
          </Card>
        );
      })()}

      {(() => {
        const slots = (o.pourSlots as Row[]) ?? [];
        const ps = o.pourSummary as Row | undefined;
        return (
          <Card title="Pour schedule" padded={false}>
            {ps && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 16 }}>
                <StatCard label="Ordered m³" value={String(ps.ordered)} />
                <StatCard label="Scheduled m³" value={String(ps.scheduled)} />
                <StatCard label="Unscheduled m³" value={String(ps.unscheduled)} />
                <StatCard label="Delivered m³" value={String(ps.delivered)} />
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  <Th numeric>Seq</Th><Th>Date</Th><Th>Start</Th><Th numeric>Qty m³</Th>
                  <Th numeric>Spacing (min)</Th><Th>Pump</Th><Th>Status</Th><Th />
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id}>
                    <Td numeric>{String(s.sequenceNo)}</Td>
                    <Td>{String(s.slotDate ?? '').slice(0, 10)}</Td>
                    <Td>{String(s.startTime ?? '—')}</Td>
                    <Td numeric>{Number(s.quantityM3).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</Td>
                    <Td numeric>{s.truckSpacingMinutes == null ? '—' : String(s.truckSpacingMinutes)}</Td>
                    <Td>{s.pumpRequired ? 'Yes' : 'No'}</Td>
                    <Td>{String(s.status)}</Td>
                    <Td style={{ textAlign: 'right' }}>
                      <Button variant="ghost" size="sm" onClick={() => run(() => ordersApi.removePourSlot(id, String(s.id)))}>Remove</Button>
                    </Td>
                  </tr>
                ))}
                {!slots.length && (
                  <tr><Td colSpan={8} style={{ color: 'var(--mn-muted)' }}>No slots scheduled yet.</Td></tr>
                )}
              </tbody>
            </Table>
            <form onSubmit={addSlot} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: 16 }}>
              <div style={{ minWidth: 140 }}><Field label="Date"><Input type="date" value={slot.slotDate} onChange={(e) => setSlot({ ...slot, slotDate: e.target.value })} required /></Field></div>
              <div style={{ minWidth: 110 }}><Field label="Start time"><Input type="time" value={slot.startTime} onChange={(e) => setSlot({ ...slot, startTime: e.target.value })} /></Field></div>
              <div style={{ minWidth: 100 }}><Field label="Qty m³"><Input type="number" step="any" value={slot.quantityM3} onChange={(e) => setSlot({ ...slot, quantityM3: e.target.value })} required /></Field></div>
              <div style={{ minWidth: 120 }}><Field label="Spacing (min)"><Input type="number" value={slot.truckSpacingMinutes} onChange={(e) => setSlot({ ...slot, truckSpacingMinutes: e.target.value })} /></Field></div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14, fontSize: 13 }}>
                <input type="checkbox" checked={slot.pumpRequired} onChange={(e) => setSlot({ ...slot, pumpRequired: e.target.checked })} /> Pump
              </label>
              <div style={{ marginBottom: 14 }}><Button type="submit" variant="secondary">Add slot</Button></div>
            </form>
          </Card>
        );
      })()}

      {holds.length > 0 && (
        <Card title="Credit holds" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th numeric>Requested</Th>
                <Th numeric>Limit</Th>
                <Th numeric>Exposure</Th>
                <Th>Status</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.id}>
                  <Td numeric>{money(h.requestedAmount)}</Td>
                  <Td numeric>{money(h.creditLimit)}</Td>
                  <Td numeric>{money(h.exposureAfter)}</Td>
                  <Td><StatusBadge status={String(h.status)} /></Td>
                  <Td>{String(h.decisionNote ?? '—')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="Status history" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>From → To</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <Td>{String(h.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                <Td>{String(h.action)}</Td>
                <Td>
                  {String(h.fromStatus ?? '—')} → {String(h.toStatus)}
                </Td>
                <Td>{String(h.note ?? '—')}</Td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <Td colSpan={4} style={{ color: 'var(--mn-muted)' }}>No history.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
