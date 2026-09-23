'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clock3, Download, FileCheck2, History, MapPin, PackageCheck, Receipt,
  RefreshCw, RotateCcw, Share2, Truck, XCircle,
} from 'lucide-react';
import { challansApi, openPdf, type Row, openWhatsAppShare } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Field, Input } from '../../../../../components/ui/Field';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { formatDateTime } from '../../../../../lib/format-date';

/**
 * Delivery challan — one load from the plant gate to the site engineer's
 * signature.
 *
 * Board header with the facts (customer, site, truck and driver, time out)
 * and the actions the stage allows; notes for a draft, a load on the road
 * (with the use-by clock), returned concrete, a delivered load waiting for
 * its invoice, or a cancelled one; five tiles; then two columns: the delivery
 * (an inline form while the load is on the road, the record once signed
 * for), the timeline and the load behind it on the left; the parties, the
 * billing and the source on the right. Same layout in both skins; every
 * colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money2 = (v: unknown) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Minutes from now to an instant; negative once it has passed. */
const minutesUntil = (v: unknown) => (v ? Math.round((new Date(String(v)).getTime() - Date.now()) / 60_000) : null);
const clockLabel = (mins: number) => {
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const span = h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return mins < 0 ? `${span} past its use-by time` : `${span} of working life left`;
};

const STEP_LABEL: Record<string, string> = {
  draft: 'Challan raised from the dispatch',
  issued: 'Issued to the driver',
  delivered: 'Signed for on site',
  cancelled: 'Cancelled',
};
const stepTone = (s: string): Tone => (s === 'delivered' ? 'success' : s === 'cancelled' ? 'danger' : s === 'issued' ? 'info' : 'neutral');

export default function ChallanDetail() {
  const { id } = useParams<{ id: string }>();
  const { prompt, confirm } = useConfirm();
  const [c, setC] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliver, setDeliver] = useState({ receiverName: 'Site Engineer', returnQuantityM3: '0', returnReason: '' });

  const load = useCallback(async () => {
    setC(await challansApi.get(id));
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      // An action may return the sentence to show (a share says where the
      // message went); a fixed okMsg still wins when the caller gives one.
      const out = await fn();
      await load();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function markDelivered() {
    const receiver = deliver.receiverName.trim();
    if (!receiver) {
      setError('Enter who received the load on site.');
      return;
    }
    const retQty = num(deliver.returnQuantityM3);
    if (retQty < 0) {
      setError('Returned quantity cannot be negative.');
      return;
    }
    if (retQty > 0 && !deliver.returnReason.trim()) {
      setError('Say why concrete came back: the wastage report groups returns by this reason.');
      return;
    }
    await run(
      () => challansApi.deliver(id, { receiverName: receiver, returnQuantityM3: retQty, ...(retQty > 0 ? { returnReason: deliver.returnReason.trim() } : {}) }),
      retQty > 0 ? `Delivered; ${qty(retQty)} m³ recorded as returned.` : 'Marked delivered.',
    );
  }

  if (!c) return error ? <ErrorState message={error} /> : <Loading label="Loading challan…" />;
  const history = (c.history as Row[]) ?? [];
  const status = String(c.challanStatus ?? '');
  const returned = num(c.returnQuantityM3);
  const invoiced = String(c.invoiceStatus ?? '') === 'invoiced';
  const useByMins = status === 'issued' ? minutesUntil(c.useBy) : null;
  const deliveredAt = [...history].reverse().find((h) => String(h.newStatus) === 'delivered')?.createdAt ?? null;
  const issuedAt = [...history].reverse().find((h) => String(h.newStatus) === 'issued')?.createdAt ?? null;
  const cancelNote = [...history].reverse().find((h) => String(h.newStatus) === 'cancelled')?.note ?? null;
  const billing: { label: string; tone: Tone } =
    status === 'cancelled' ? { label: 'Nothing to bill', tone: 'neutral' }
      : status !== 'delivered' ? { label: 'After delivery', tone: 'neutral' }
        : invoiced ? { label: String(c.invoiceNo ?? 'Invoiced'), tone: 'success' }
          : { label: 'To invoice', tone: 'warning' };

  return (
    <div className="mn-od mn-cd">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/dispatch/challans" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Delivery challans</Link>
          <h1>
            {String(c.challanNo ?? '')}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              {status === 'delivered' && <StatusBadge status={String(c.invoiceStatus ?? 'not_invoiced')} />}
              {returned > 0 && <Badge tone="warning">{qty(returned)} m³ returned</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><Building2 size={14} aria-hidden /> {String(c.customerName ?? 'Customer')}</span>
            {c.siteName ? <span className="mn-od-fact"><MapPin size={14} aria-hidden /> {String(c.siteName)}</span> : null}
            <span className="mn-od-fact"><Truck size={14} aria-hidden /> {String(c.vehicleNo ?? 'No truck')}{c.driverName ? ` · ${String(c.driverName)}` : ''}</span>
            <span className="mn-od-fact"><Clock3 size={14} aria-hidden /> {c.dispatchTime ? `Out ${formatDateTime(c.dispatchTime)}` : 'Not out yet'}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          {status === 'draft' && (
            <Button
              loading={busy}
              onClick={() =>
                run(async () => {
                  if (!(await confirm({ title: 'Issue challan', message: 'Issuing hands the challan to the driver: it travels with the load and the site engineer signs it on delivery. Continue?', confirmLabel: 'Issue' }))) return;
                  await challansApi.issue(id);
                }, 'Challan issued')
              }
            >
              Issue
            </Button>
          )}
          {status === 'issued' && (
            <Button loading={busy} icon={<PackageCheck size={14} />} onClick={markDelivered}>Mark delivered</Button>
          )}
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => openPdf(`/delivery-challans/${id}/pdf`, String(c?.challanNo ?? '')).catch((e) => setError(String(e)))}>
            Print / PDF
          </Button>
          <Button
            variant="secondary"
            icon={<Share2 size={14} />}
            onClick={() =>
              run(async () => {
                const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile (WhatsApp)', defaultValue: String(c.driverMobile ?? '') });
                if (m === null) return 'Not shared.';
                return openWhatsAppShare(() => challansApi.share(id, m));
              })
            }
          >
            Share on WhatsApp
          </Button>
          {(status === 'draft' || status === 'issued') && (
            <Button
              variant="ghost"
              icon={<XCircle size={14} />}
              onClick={() =>
                run(async () => {
                  const reason = await prompt({ title: 'Cancel challan', message: 'Cancel this challan? The load itself is handled on the Dispatch board; a rejected or cancelled trip should be cancelled here rather than delivered.', label: 'Reason', defaultValue: '' });
                  if (reason !== null) await challansApi.cancel(id, reason);
                }, 'Challan cancelled')
              }
            >
              Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => run(async () => undefined)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><FileCheck2 size={16} aria-hidden /><span>{msg}</span></div>}

      {status === 'draft' && (
        <div className="mn-ord-note" role="status">
          <Clock3 size={16} aria-hidden />
          <span><strong>Not issued yet.</strong> The challan exists but has not been handed to the driver. Press Issue when the truck leaves.</span>
        </div>
      )}
      {status === 'issued' && useByMins != null && (
        <div className={`mn-ord-note ${useByMins < 0 ? 'mn-ord-note--bad' : useByMins <= 30 ? 'mn-ord-note--warn' : ''}`} role="status">
          <Clock3 size={16} aria-hidden />
          <span>
            <strong>On the road{issuedAt ? ` since ${formatDateTime(issuedAt)}` : ''}.</strong>{' '}
            Batched {formatDateTime(c.batchedAt)}; use by {formatDateTime(c.useBy)} · {clockLabel(useByMins)}.
            {useByMins < 0 ? ' Check the concrete with the site engineer before placing.' : ''}
          </span>
        </div>
      )}
      {status === 'issued' && useByMins == null && (
        <div className="mn-ord-note" role="status">
          <Clock3 size={16} aria-hidden />
          <span><strong>On the road{issuedAt ? ` since ${formatDateTime(issuedAt)}` : ''}.</strong> Fill in who received it below once the load is placed.</span>
        </div>
      )}
      {status === 'delivered' && returned > 0 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <RotateCcw size={16} aria-hidden />
          <span>
            <strong>{qty(returned)} m³ came back{c.returnReason ? `: ${String(c.returnReason)}` : ''}.</strong>{' '}
            {num(c.returnCost) > 0 ? `${money2(c.returnCost)} written off as wastage. ` : ''}It shows in the returned-concrete report under Delivery challans.
          </span>
        </div>
      )}
      {status === 'delivered' && !invoiced && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Receipt size={16} aria-hidden />
          <span>
            <strong>Delivered, not yet invoiced.</strong> Raise the invoice from <Link href="/app/billing/invoices">Billing → Invoices</Link> (From challans); this load will be listed for its customer.
          </span>
        </div>
      )}
      {status === 'cancelled' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span><strong>Cancelled{cancelNote ? `: ${String(cancelNote)}` : ''}.</strong> Nothing is billed for it. If the load still went out, raise a fresh challan from the dispatch.</span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Quantity" value={`${qty(c.quantityM3)} m³`} />
        <StatCard label="Grade" value={String(c.gradeLabel ?? '—')} />
        <StatCard label="Slump" value={c.slump ? `${String(c.slump)} mm` : '—'} />
        <StatCard label="Returned" value={`${qty(returned)} m³`} tone={returned > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Billing" value={billing.label} tone={billing.tone} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><PackageCheck size={16} aria-hidden /> Delivery</span>}>
            {status === 'issued' ? (
              <>
                <p className="mn-board-form-hint" style={{ margin: '0 0 12px' }}>
                  Record what happened on site. Concrete that came back is priced at the mix cost and lands in the wastage report; the order bills the delivered quantity under its return policy.
                </p>
                <div className="mn-cd-form">
                  <Field label="Received by" required>
                    <Input value={deliver.receiverName} onChange={(e) => setDeliver({ ...deliver, receiverName: e.target.value })} placeholder="Name on site" />
                  </Field>
                  <Field label="Returned (m³)">
                    <Input type="number" step="any" inputMode="decimal" min={0} value={deliver.returnQuantityM3} onChange={(e) => setDeliver({ ...deliver, returnQuantityM3: e.target.value })} />
                  </Field>
                  <Field label={num(deliver.returnQuantityM3) > 0 ? 'Why it came back' : 'Return reason (only if concrete came back)'}>
                    <Input value={deliver.returnReason} onChange={(e) => setDeliver({ ...deliver, returnReason: e.target.value })} placeholder="excess ordered, pump breakdown, site not ready…" />
                  </Field>
                </div>
                <div className="mn-cd-form-submit">
                  <Button icon={<CheckCircle2 size={14} />} onClick={markDelivered} loading={busy}>Mark delivered</Button>
                  <span className="mn-ord-meta">
                    {num(deliver.returnQuantityM3) > 0
                      ? `${qty(Math.max(0, num(c.quantityM3) - num(deliver.returnQuantityM3)))} m³ placed, ${qty(deliver.returnQuantityM3)} m³ back`
                      : `${qty(c.quantityM3)} m³ placed in full`}
                  </span>
                </div>
              </>
            ) : status === 'delivered' ? (
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Received by</dt><dd>{String(c.receiverName ?? '—')}</dd></div>
                <div><dt>Delivered at</dt><dd>{deliveredAt ? formatDateTime(deliveredAt) : '—'}</dd></div>
                <div><dt>Placed</dt><dd>{qty(Math.max(0, num(c.quantityM3) - returned))} m³</dd></div>
                <div><dt>Returned</dt><dd>{qty(returned)} m³</dd></div>
                {returned > 0 && <div><dt>Reason</dt><dd className="mn-id-wrap">{String(c.returnReason ?? '—')}</dd></div>}
                {returned > 0 && <div><dt>Return cost</dt><dd>{money2(c.returnCost)}{num(c.returnCostPerM3) > 0 ? ` (${money2(c.returnCostPerM3)}/m³)` : ''}</dd></div>}
              </dl>
            ) : (
              <p className="mn-board-form-hint" style={{ margin: 0 }}>
                {status === 'draft' ? 'Issue the challan first; the delivery is recorded once the load is placed.' : 'This challan was cancelled before delivery.'}
              </p>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> The load</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Dispatch</dt><dd>{c.dispatchNo ? <Link href="/app/dispatch/board" className="mn-id-link">{String(c.dispatchNo)}</Link> : '—'}{c.dispatchStatus ? <span className="mn-ord-meta"> · {String(c.dispatchStatus).replace(/_/g, ' ')}</span> : null}</dd></div>
              <div><dt>Batch ticket</dt><dd>{c.batchTicketId ? <Link href={`/app/production/batch-tickets/${String(c.batchTicketId)}`} className="mn-id-link">{String(c.batchTicketNo ?? 'Ticket')}</Link> : '—'}</dd></div>
              <div><dt>Batched at</dt><dd>{c.batchedAt ? formatDateTime(c.batchedAt) : '—'}</dd></div>
              <div><dt>Use by</dt><dd>{c.useBy ? `${formatDateTime(c.useBy)} (${String(c.concreteSlaMinutes ?? 120)} min working life)` : '—'}</dd></div>
              <div><dt>Left the plant</dt><dd>{c.dispatchTime ? formatDateTime(c.dispatchTime) : '—'}</dd></div>
              {c.siteArrivalTime ? <div><dt>Reached site</dt><dd>{formatDateTime(c.siteArrivalTime)}</dd></div> : null}
              {c.pourStartTime ? <div><dt>Pour</dt><dd>{formatDateTime(c.pourStartTime)}{c.pourEndTime ? ` → ${formatDateTime(c.pourEndTime)}` : ''}</dd></div> : null}
            </dl>
          </Card>

          <Card title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Timeline</span>}>
            {history.length ? (
              <ol className="mn-od-tl">
                {[...history].reverse().map((h) => {
                  const to = String(h.newStatus ?? '');
                  return (
                    <li key={String(h.id)} data-tone={stepTone(to)}>
                      <span className="mn-od-tl-dot" aria-hidden />
                      <div className="mn-od-tl-body">
                        <span className="mn-od-tl-title">{STEP_LABEL[to] ?? to}</span>
                        <span className="mn-ord-meta">{formatDateTime(h.createdAt)}{h.oldStatus ? <><span className="mn-ord-dot" aria-hidden>·</span>from {String(h.oldStatus)}</> : null}</span>
                        {h.note ? <span className="mn-od-tl-note">{String(h.note)}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mn-board-form-hint" style={{ margin: 0 }}>No history recorded yet.</p>
            )}
          </Card>
        </div>

        <aside className="mn-od-side">
          <Card title="Parties">
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Customer</dt><dd>{String(c.customerName ?? '—')}</dd></div>
              <div><dt>Site</dt><dd>{String(c.siteName ?? '—')}</dd></div>
              {c.siteAddress ? <div><dt>Address</dt><dd className="mn-id-wrap">{String(c.siteAddress)}</dd></div> : null}
              {c.siteContact ? <div><dt>Site contact</dt><dd className="mn-id-wrap">{String(c.siteContact)}</dd></div> : null}
              <div><dt>Truck</dt><dd>{String(c.vehicleNo ?? '—')}</dd></div>
              <div><dt>Driver</dt><dd>{String(c.driverName ?? '—')}{c.driverMobile ? <span className="mn-ord-meta"> · {String(c.driverMobile)}</span> : null}</dd></div>
            </dl>
          </Card>

          <Card title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Billing</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Invoice</dt><dd>{c.invoiceId ? <Link href={`/app/billing/invoices/${String(c.invoiceId)}`} className="mn-id-link">{String(c.invoiceNo ?? 'Draft invoice')}</Link> : status === 'delivered' ? 'Not yet raised' : '—'}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={String(c.invoiceStatus ?? 'not_invoiced')} /></dd></div>
              {c.ewayBillNo ? <div><dt>E-way bill</dt><dd>{String(c.ewayBillNo)}</dd></div> : null}
            </dl>
            <p className="mn-board-form-hint">
              {invoiced ? 'This load is on the invoice above; the e-way bill number prints on the challan once it exists.' : 'A delivered challan is picked up when its customer is invoiced from challans.'}
            </p>
          </Card>

          <Card title="Source">
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Order</dt><dd>{c.orderId ? <Link href={`/app/orders/${String(c.orderId)}`} className="mn-id-link">{String(c.orderNo ?? 'Order')}</Link> : '—'}</dd></div>
              <div><dt>Raised</dt><dd>{formatDateTime(c.createdAt)}</dd></div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
