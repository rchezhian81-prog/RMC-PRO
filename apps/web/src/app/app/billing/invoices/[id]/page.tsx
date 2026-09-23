'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, Download, FileCheck2, FileText, History, MapPin, PenLine,
  Receipt, RefreshCw, Share2, Truck, Wallet,
} from 'lucide-react';
import { invoicesApi, gstApi, crud, creditNotesApi, openPdf, type GstStatus, type Row, openWhatsAppShare } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Field, Input } from '../../../../../components/ui/Field';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { getAccess } from '../../../../../lib/session';
import { formatDate, formatDateTime } from '../../../../../lib/format-date';
import { money } from '../../../../../lib/money';

/**
 * Invoice — one tax invoice from draft to settled.
 *
 * Board header with the facts (customer, site, date, due) and the actions the
 * stage allows; notes for money past due, an unissued draft or a cancelled
 * invoice; six tiles (total, taxable, GST, paid, outstanding, due); then two
 * columns: the lines, the challans it bills, credit / debit notes and the
 * receipts applied on the left; the money, the transport details that feed
 * the e-way bill, GST compliance and the supply details on the right. Same
 * layout in both skins; every colour reads the semantic tokens.
 */

const TRANSPORT_MODES = [
  { value: 'road', label: 'Road' },
  { value: 'rail', label: 'Rail' },
  { value: 'air', label: 'Air' },
  { value: 'ship', label: 'Ship' },
];

/** IRN cancellation reasons (NIC): 1=Duplicate, 2=Data entry, 3=Order cancelled, 4=Other. */
const IRN_CANCEL_REASONS = [
  { value: '1', label: '1 — Duplicate' },
  { value: '2', label: '2 — Data entry mistake' },
  { value: '3', label: '3 — Order cancelled' },
  { value: '4', label: '4 — Other' },
];
/** e-way cancellation reasons (NIC): 1=Duplicate, 2=Order cancelled, 3=Data entry, 4=Other. */
const EWAY_CANCEL_REASONS = [
  { value: '1', label: '1 — Duplicate' },
  { value: '2', label: '2 — Order cancelled' },
  { value: '3', label: '3 — Data entry mistake' },
  { value: '4', label: '4 — Other' },
];

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const money2 = (v: unknown) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Days from today to a bare yyyy-mm-dd date, in the browser's local calendar. */
function daysUntil(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const MODE_LABEL: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card' };
const modeLabel = (m: unknown) => (m ? MODE_LABEL[String(m)] ?? String(m).replace(/_/g, ' ') : 'Receipt');

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { confirm, prompt } = useConfirm();
  const [inv, setInv] = useState<Row | null>(null);
  const [gst, setGst] = useState<GstStatus | null>(null);
  const [transporters, setTransporters] = useState<Row[]>([]);
  const [tp, setTp] = useState({ transporterId: '', vehicleNo: '', transportMode: '', distanceKm: '', ewayBillNo: '', ewayValidUntil: '' });
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Row[]>([]);
  const [noteForm, setNoteForm] = useState<{ open: boolean; noteType: 'credit' | 'debit'; reason: string; remarks: string; lines: { description: string; hsnSac: string; uom: string; quantity: string; rate: string; gstRate: string }[] } | null>(null);
  const [reasons, setReasons] = useState<{ value: string; label: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const full = await invoicesApi.get(id);
    setInv(full);
    // Seed the transport form from the saved invoice (normalised values show
    // after each save/reload).
    setTp({
      transporterId: String(full.transporterId ?? ''),
      vehicleNo: String(full.vehicleNo ?? ''),
      transportMode: String(full.transportMode ?? ''),
      distanceKm: full.distanceKm != null ? String(full.distanceKm) : '',
      ewayBillNo: String(full.ewayBillNo ?? ''),
      ewayValidUntil: full.ewayValidUntil ? String(full.ewayValidUntil).slice(0, 10) : '',
    });
    // Notes against this invoice ride along with every reload (issue / cancel
    // of a note changes the invoice balance shown above).
    creditNotesApi.forInvoice(id).then(setNotes).catch(() => setNotes([]));
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
    // Best-effort: unavailable (403 for non-agents users) → no live GST actions.
    gstApi.status().then(setGst).catch(() => setGst(null));
    crud('transporters').list().then(setTransporters).catch(() => setTransporters([]));
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

  function saveTransport() {
    return run(
      () =>
        invoicesApi.setTransport(id, {
          transporterId: tp.transporterId || null,
          vehicleNo: tp.vehicleNo.trim() || null,
          transportMode: tp.transportMode || null,
          distanceKm: tp.distanceKm === '' ? null : Number(tp.distanceKm),
          ewayBillNo: tp.ewayBillNo.trim() || null,
          ewayValidUntil: tp.ewayValidUntil || null,
        }),
      'Transport details saved',
    );
  }

  /**
   * A credit note starts from the invoice's own lines (edit quantity or rate
   * down to what is being credited); a debit note starts empty. Raised only
   * against an issued invoice; the API refuses otherwise.
   */
  async function openNoteForm(noteType: 'credit' | 'debit') {
    setError(null);
    try {
      const [lines, rs] = await Promise.all([creditNotesApi.invoiceLines(id), reasons.length ? Promise.resolve(reasons) : creditNotesApi.reasons()]);
      setReasons(rs);
      const blank = { description: '', hsnSac: '', uom: '', quantity: '', rate: '', gstRate: '18' };
      setNoteForm({
        open: true, noteType, reason: noteType === 'debit' ? 'additional_charge' : 'rate_difference', remarks: '',
        lines: noteType === 'credit' && lines.length
          ? lines.map((l) => ({ description: String(l.description ?? ''), hsnSac: String(l.hsnSac ?? ''), uom: String(l.uom ?? ''), quantity: String(l.quantity ?? ''), rate: String(l.rate ?? ''), gstRate: String(l.gstRate ?? '18') }))
          : [blank],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function setLine(i: number, k: string, v: string) {
    setNoteForm((f) => (f ? { ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) } : f));
  }
  async function createNote() {
    if (!noteForm) return;
    await run(async () => {
      const lines = noteForm.lines.filter((l) => Number(l.quantity) > 0 && Number(l.rate) > 0).map((l) => ({
        description: l.description, hsnSac: l.hsnSac, uom: l.uom, quantity: Number(l.quantity), rate: Number(l.rate), gstRate: Number(l.gstRate || 0),
      }));
      const n = await creditNotesApi.create({ invoiceId: id, noteType: noteForm.noteType, reason: noteForm.reason, remarks: noteForm.remarks, lines });
      setNoteForm(null);
      return `${noteForm.noteType === 'debit' ? 'Debit' : 'Credit'} note drafted for ${money2(n.totalAmount)} — issue it below to make it count.`;
    });
  }

  if (!inv) return error ? <ErrorState message={error} /> : <Loading label="Loading invoice…" />;
  const items = (inv.items as Row[]) ?? [];
  const challans = (inv.challans as Row[]) ?? [];
  const receipts = (inv.receipts as Row[]) ?? [];
  const status = String(inv.invoiceStatus);
  const paymentStatus = String(inv.paymentStatus ?? 'unpaid');
  const outstanding = num(inv.outstandingAmount);
  const paid = num(inv.amountPaid);
  const gstAmt = num(inv.cgstAmount) + num(inv.sgstAmount) + num(inv.igstAmount) + num(inv.cessAmount);
  const totalQty = items.reduce((t, it) => t + num(it.quantity), 0);
  const settled = ['paid', 'credited', 'written_off'].includes(paymentStatus) || (status === 'issued' && outstanding <= 0.001);
  const dueRaw = String(inv.dueDate ?? '').slice(0, 10);
  const days = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? daysUntil(dueRaw) : null;
  const due: { label: string; tone: Tone } =
    status === 'cancelled' ? { label: 'Cancelled', tone: 'neutral' }
      : status === 'draft' ? { label: 'Not issued yet', tone: 'neutral' }
        : settled ? { label: 'Settled', tone: 'success' }
          : days == null ? { label: 'No due date', tone: 'warning' }
            : days < 0 ? { label: `${-days} ${-days === 1 ? 'day' : 'days'} past due`, tone: 'danger' }
              : days === 0 ? { label: 'Due today', tone: 'warning' }
                : days <= 3 ? { label: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' }
                  : { label: `Due in ${days} days`, tone: 'neutral' };
  const canApprove = getAccess().has('invoice_cancellation.approve');
  const einv = String(inv.einvoiceStatus ?? 'not_generated');
  const eway = String(inv.ewayStatus ?? 'not_generated');
  const canGst = getAccess().has('agents.manage') && getAccess().has('agents.approve');
  const issued = status !== 'draft' && status !== 'cancelled';
  const live = Boolean(gst?.configured) && canGst && issued;
  const gstNotice = !gst?.configured
    ? 'GST transmission is not enabled — the fields here are stored but not filed with the portal.'
    : !canGst
      ? 'You do not have permission to file GST documents (needs agents.manage + agents.approve).'
      : !issued
        ? 'Issue the invoice before filing its e-invoice / e-way bill.'
        : null;
  const transporterName = String(inv.transporterName ?? (inv.transporterId ? transporters.find((t) => String(t.id) === String(inv.transporterId))?.transporterName ?? '—' : '—'));

  return (
    <div className="mn-od mn-id">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/billing/invoices" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Invoices</Link>
          <h1>
            {/* Unnumbered until issued — String(null) would read "null" here. */}
            {inv.invoiceNo ? String(inv.invoiceNo) : 'Draft invoice'}
            <span className="mn-od-badges">
              <StatusBadge status={status} />
              {status !== 'draft' && status !== 'cancelled' && <StatusBadge status={paymentStatus} />}
              {einv === 'generated' && <Badge tone="success">e-invoice</Badge>}
              {eway === 'generated' && <Badge tone="info">e-way</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who"><Building2 size={14} aria-hidden /> {String(inv.customerName ?? 'Customer')}</span>
            {inv.siteName ? <span className="mn-od-fact"><MapPin size={14} aria-hidden /> {String(inv.siteName)}</span> : null}
            <span className="mn-od-fact"><FileText size={14} aria-hidden /> {inv.invoiceDate ? `Dated ${formatDate(inv.invoiceDate)}` : 'No date yet'}</span>
            <span className="mn-od-fact" data-tone={due.tone}>
              <CalendarClock size={14} aria-hidden />
              <span className="mn-qd-validity">{inv.dueDate ? `Due ${formatDate(inv.dueDate)} · ${due.label}` : due.label}</span>
            </span>
          </p>
        </div>
        <div className="mn-board-tools">
          {status === 'draft' && (
            <Button
              loading={busy}
              onClick={() =>
                run(async () => {
                  if (!(await confirm({ title: 'Issue invoice', message: 'Issuing takes the next invoice number, locks the lines and creates the GST liability. Continue?', confirmLabel: 'Issue' }))) return;
                  await invoicesApi.issue(id);
                }, 'Invoice issued')
              }
            >
              Issue
            </Button>
          )}
          {status === 'issued' && outstanding > 0.001 && (
            <Link href={`/app/billing/receipts?customerId=${encodeURIComponent(String(inv.customerId ?? ''))}`} className="mn-ord-link">
              <Button icon={<Wallet size={14} />}>Record receipt</Button>
            </Link>
          )}
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => openPdf(`/invoices/${id}/pdf`, String(inv.invoiceNo ?? 'Draft invoice')).catch((e) => setError(String(e)))}>
            Print / PDF
          </Button>
          <Button
            variant="secondary"
            icon={<Share2 size={14} />}
            onClick={() =>
              run(async () => {
                const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile', defaultValue: '' });
                if (m === null) return 'Not shared.';
                return openWhatsAppShare(() => invoicesApi.share(id, m));
              })
            }
          >
            Share on WhatsApp
          </Button>
          {status === 'issued' && (
            <>
              <Button variant="secondary" onClick={() => openNoteForm('credit')}>Credit note</Button>
              <Button variant="secondary" onClick={() => openNoteForm('debit')}>Debit note</Button>
            </>
          )}
          {status === 'issued' && outstanding > 0 && canApprove && (
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const a = await prompt({
                    title: 'Write off outstanding',
                    message: 'Write off part or all of the outstanding balance as a bad debt. The amount paid is left unchanged.',
                    label: 'Amount (₹)',
                    defaultValue: String(inv.outstandingAmount ?? ''),
                  });
                  if (a === null) return;
                  const amount = Number(a);
                  if (!(amount > 0)) throw new Error('Enter an amount greater than zero');
                  const r = await prompt({ title: 'Write off outstanding', label: 'Reason', defaultValue: '' });
                  if (r === null) return;
                  await invoicesApi.writeoff(id, amount, r);
                }, 'Outstanding written off')
              }
            >
              Write off
            </Button>
          )}
          {status === 'issued' && num(inv.writtenOffAmount) > 0 && canApprove && (
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const a = await prompt({
                    title: 'Reverse write-off',
                    message: 'Put part or all of the written-off amount back onto the outstanding balance (for example the customer paid after all). Cancelling an invoice requires its write-off to be fully reversed first.',
                    label: 'Amount (₹)',
                    defaultValue: String(inv.writtenOffAmount ?? ''),
                  });
                  if (a === null) return;
                  const amount = Number(a);
                  if (!(amount > 0)) throw new Error('Enter an amount greater than zero');
                  const r = await prompt({ title: 'Reverse write-off', label: 'Reason', defaultValue: '' });
                  if (r === null) return;
                  await invoicesApi.reverseWriteoff(id, amount, r);
                }, 'Write-off reversed')
              }
            >
              Reverse write-off
            </Button>
          )}
          {status !== 'cancelled' && paid === 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                run(async () => {
                  const r = await prompt({ title: 'Cancel invoice', message: 'The challans it bills become billable again. An issued number is not reused.', label: 'Cancel reason', defaultValue: '' });
                  if (r !== null) await invoicesApi.cancel(id, r);
                }, 'Invoice cancelled')
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

      {status === 'issued' && due.tone === 'danger' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span>
            <strong>{money(outstanding)} is {due.label}.</strong>{' '}
            {paid > 0 ? `${money(paid)} has come in so far. ` : ''}Record what comes in under <Link href="/app/billing/receipts">Billing → Receipts</Link>; it settles this invoice automatically.
          </span>
        </div>
      )}
      {status === 'draft' && (
        <div className="mn-ord-note" role="status">
          <PenLine size={16} aria-hidden />
          <span>
            <strong>This is a draft.</strong> It has no number and creates no GST liability until you press Issue. Check the lines and the due date first; issuing locks them.
          </span>
        </div>
      )}
      {status === 'cancelled' && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span><strong>Cancelled.</strong> Nothing is owed on it, and the challans it billed are billable again.</span>
        </div>
      )}

      <div className="mn-od-kpis">
        <StatCard label="Invoice total" value={money(inv.totalAmount)} />
        <StatCard label="Taxable" value={money(inv.taxableAmount)} />
        <StatCard label={inv.isInterstate ? 'IGST' : 'CGST + SGST'} value={money(gstAmt)} />
        <StatCard label="Paid" value={money(paid)} tone={paid > 0 ? 'success' : 'neutral'} />
        <StatCard label="Outstanding" value={money(outstanding)} tone={status === 'cancelled' ? 'neutral' : outstanding > 0.001 ? (due.tone === 'danger' ? 'danger' : 'warning') : 'success'} />
        <StatCard label="Quantity billed" value={`${qty(totalQty)} m³`} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Lines <span className="mn-board-card-count">{items.length}</span></span>} padded={false}>
            {items.length ? (
              <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr>
                    <Th>Description</Th>
                    <Th>HSN/SAC</Th>
                    <Th numeric>Qty</Th>
                    <Th numeric>Rate</Th>
                    <Th numeric>Taxable</Th>
                    <Th numeric>GST</Th>
                    <Th numeric>Line total</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={String(it.id)}>
                      <Td><span className="mn-od-grade">{String(it.description ?? '—')}</span></Td>
                      <Td className="mn-od-num">{String(it.hsnSac ?? '—')}</Td>
                      <Td numeric className="mn-od-num">{qty(it.quantity)} {String(it.uom ?? '')}</Td>
                      <Td numeric className="mn-od-num">{money2(it.rate)}</Td>
                      <Td numeric className="mn-od-num">{money2(it.taxableAmount)}</Td>
                      <Td numeric className="mn-od-num">{money2(num(it.lineTotal) - num(it.taxableAmount))}<span className="mn-od-rate-meta">{String(Number(it.gstRate))}%</span></Td>
                      <Td numeric className="mn-od-num">{money2(it.lineTotal)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              </div>
            ) : (
              <p className="mn-board-form-hint mn-qd-locked">No lines. A draft raised without a billable challan has nothing to invoice; cancel it.</p>
            )}
            <div className="mn-od-lines-foot">
              <span className="mn-ord-meta">{items.length} {items.length === 1 ? 'line' : 'lines'} · {qty(totalQty)} m³ · {inv.isInterstate ? 'inter-state supply, IGST' : 'intra-state supply, CGST + SGST'}</span>
              <span className="mn-od-lines-total">Total <strong>{money2(inv.totalAmount)}</strong></span>
            </div>
          </Card>

          {challans.length > 0 && (
            <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> Challans billed <span className="mn-board-card-count">{challans.length}</span></span>} padded={false}>
              <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr><Th>Challan</Th><Th>Delivered</Th><Th>Grade</Th><Th numeric>Billed m³</Th></tr>
                </thead>
                <tbody>
                  {challans.map((c) => (
                    <tr key={String(c.id)}>
                      <Td><Link href={`/app/dispatch/challans/${String(c.challanId)}`} className="mn-id-link">{String(c.challanNo ?? 'Challan')}</Link></Td>
                      <Td>{c.dispatchTime ? formatDateTime(c.dispatchTime) : '—'}</Td>
                      <Td>{String(c.gradeLabel ?? '—')}</Td>
                      <Td numeric className="mn-od-num">{qty(c.quantityM3)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              </div>
            </Card>
          )}

          {noteForm?.open && (
            <Card title={<span className="mn-board-card-title"><PenLine size={16} aria-hidden /> {noteForm.noteType === 'debit' ? 'New debit note' : 'New credit note'}</span>}>
              <p className="mn-board-form-hint" style={{ margin: '0 0 12px' }}>
                {noteForm.noteType === 'debit'
                  ? 'What is being added to this invoice — an extra charge, an under-billed quantity or rate.'
                  : 'What is being credited back — set each line to the quantity and rate being credited, and remove lines that are not.'}
                {' '}The note is a draft until it is issued.
              </p>
              <div className="mn-id-note-head">
                <Field label="Reason">
                  <select className="mn-input" value={noteForm.reason} onChange={(e) => setNoteForm({ ...noteForm, reason: e.target.value })}>
                    {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label="Remarks (printed on the note)">
                  <Input value={noteForm.remarks} onChange={(e) => setNoteForm({ ...noteForm, remarks: e.target.value })} />
                </Field>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr><Th>Description</Th><Th>HSN/SAC</Th><Th>UOM</Th><Th numeric>Qty</Th><Th numeric>Rate</Th><Th numeric>GST %</Th><Th /></tr>
                  </thead>
                  <tbody>
                    {noteForm.lines.map((l, i) => (
                      <tr key={i}>
                        <Td><Input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></Td>
                        <Td><Input value={l.hsnSac} onChange={(e) => setLine(i, 'hsnSac', e.target.value)} style={{ width: 90 }} /></Td>
                        <Td><Input value={l.uom} onChange={(e) => setLine(i, 'uom', e.target.value)} style={{ width: 70 }} /></Td>
                        <Td numeric><Input type="number" step="any" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} style={{ width: 100, textAlign: 'right' }} /></Td>
                        <Td numeric><Input type="number" step="any" value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} style={{ width: 110, textAlign: 'right' }} /></Td>
                        <Td numeric><Input type="number" step="any" value={l.gstRate} onChange={(e) => setLine(i, 'gstRate', e.target.value)} style={{ width: 70, textAlign: 'right' }} /></Td>
                        <Td><Button variant="ghost" size="sm" onClick={() => setNoteForm({ ...noteForm, lines: noteForm.lines.filter((_, j) => j !== i) })}>Remove</Button></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="mn-id-note-acts">
                <Button variant="secondary" onClick={() => setNoteForm({ ...noteForm, lines: [...noteForm.lines, { description: '', hsnSac: '', uom: '', quantity: '', rate: '', gstRate: '18' }] })}>Add line</Button>
                <Button onClick={createNote} loading={busy}>Create draft</Button>
                <Button variant="ghost" onClick={() => setNoteForm(null)}>Cancel</Button>
              </div>
            </Card>
          )}

          {notes.length > 0 && (
            <Card title={<span className="mn-board-card-title"><FileCheck2 size={16} aria-hidden /> Credit / debit notes <span className="mn-board-card-count">{notes.length}</span></span>} padded={false}>
              <div className="mn-id-scroll">
              <Table>
                <thead>
                  <tr><Th>Note</Th><Th>Type</Th><Th>Date</Th><Th>Reason</Th><Th numeric>Total</Th><Th>Status</Th><Th /></tr>
                </thead>
                <tbody>
                  {notes.map((n) => {
                    const nid = String(n.id); const nst = String(n.status); const no = String(n.noteNo ?? '');
                    return (
                      <tr key={nid}>
                        <Td style={{ fontWeight: 600 }}>{no || <span className="mn-inv-draft">Draft</span>}</Td>
                        <Td>{n.noteType === 'debit' ? 'Debit' : 'Credit'}</Td>
                        <Td>{formatDate(n.noteDate)}</Td>
                        <Td>{String(n.reason ?? '—').replace(/_/g, ' ')}</Td>
                        <Td numeric className="mn-od-num">{money2(n.totalAmount)}</Td>
                        <Td><StatusBadge status={nst} /></Td>
                        <Td style={{ textAlign: 'right' }}>
                          <div className="mn-id-row-acts">
                            <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/credit-notes/${nid}/pdf`, no || 'Draft note').catch((e) => setError(String(e)))}>Print</Button>
                            {canApprove && nst === 'draft' && (
                              <Button size="sm" onClick={async () => {
                                if (!(await confirm({ title: 'Issue note', message: `Issue this note for ${money2(n.totalAmount)}? It takes a number and changes what the customer owes.`, confirmLabel: 'Issue' }))) return;
                                run(() => creditNotesApi.issue(nid), 'Note issued.');
                              }}>Issue</Button>
                            )}
                            {canApprove && nst !== 'cancelled' && (
                              <Button variant="ghost" size="sm" onClick={async () => {
                                const reason = await prompt({ title: 'Cancel note', label: 'Reason', defaultValue: '' });
                                if (reason === null) return;
                                run(() => creditNotesApi.cancel(nid, reason), 'Note cancelled.');
                              }}>Cancel</Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              </div>
              <p className="mn-board-form-hint mn-qd-locked">
                All notes: <Link href="/app/billing/credit-notes">Billing → Credit notes</Link>.
              </p>
            </Card>
          )}

          <Card title={<span className="mn-board-card-title"><History size={16} aria-hidden /> Receipts applied</span>}>
            {receipts.length ? (
              <ol className="mn-od-tl">
                {[...receipts].reverse().map((r) => {
                  const st = String(r.status ?? 'posted');
                  const clearing = String(r.clearingStatus ?? '');
                  const dead = st === 'reversed' || clearing === 'bounced';
                  return (
                    <li key={String(r.id)} data-tone={dead ? 'danger' : clearing === 'deposited' ? 'warning' : 'success'}>
                      <span className="mn-od-tl-dot" aria-hidden />
                      <div className="mn-od-tl-body">
                        <span className="mn-od-tl-title">
                          {money2(r.allocatedAmount)} by {modeLabel(r.paymentMode)}
                          {dead ? ` · ${st === 'reversed' ? 'reversed' : 'bounced'}` : clearing === 'deposited' ? ' · cheque not yet cleared' : ''}
                        </span>
                        <span className="mn-ord-meta">
                          {formatDate(r.receiptDate)}<span className="mn-ord-dot" aria-hidden>·</span>
                          <Link href="/app/billing/receipts" className="mn-id-link">{String(r.receiptNo ?? 'Receipt')}</Link>
                          {r.bankReference ? <><span className="mn-ord-dot" aria-hidden>·</span>ref {String(r.bankReference)}</> : null}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mn-board-form-hint" style={{ margin: 0 }}>
                {status === 'draft' ? 'Nothing can be received against a draft. Issue it first.'
                  : status === 'cancelled' ? 'Nothing was received against this invoice.'
                    : 'Nothing received yet. Record a receipt under Billing → Receipts and it is applied to the oldest open invoice first.'}
              </p>
            )}
          </Card>
        </div>

        <aside className="mn-od-side">
          <Card title="Money">
            <dl className="mn-od-money">
              <div><dt>Taxable value</dt><dd>{money2(inv.taxableAmount)}</dd></div>
              {num(inv.cgstAmount) > 0 && <div><dt>CGST</dt><dd>{money2(inv.cgstAmount)}</dd></div>}
              {num(inv.sgstAmount) > 0 && <div><dt>SGST</dt><dd>{money2(inv.sgstAmount)}</dd></div>}
              {num(inv.igstAmount) > 0 && <div><dt>IGST</dt><dd>{money2(inv.igstAmount)}</dd></div>}
              {num(inv.cessAmount) > 0 && <div><dt>Cess</dt><dd>{money2(inv.cessAmount)}</dd></div>}
              {num(inv.roundOff) !== 0 && <div><dt>Round off</dt><dd>{money2(inv.roundOff)}</dd></div>}
              <div className="mn-od-money-total"><dt>Invoice total</dt><dd>{money2(inv.totalAmount)}</dd></div>
              {num(inv.debitNoteAmount) > 0 && <div><dt>Debit notes</dt><dd>+ {money2(inv.debitNoteAmount)}</dd></div>}
              {num(inv.creditNoteAmount) > 0 && <div><dt>Credit notes</dt><dd>− {money2(inv.creditNoteAmount)}</dd></div>}
              <div><dt>Paid</dt><dd>− {money2(paid)}</dd></div>
              {num(inv.writtenOffAmount) > 0 && <div><dt>Written off</dt><dd className="mn-id-bad">− {money2(inv.writtenOffAmount)}</dd></div>}
              <div className="mn-od-money-total" data-tone={status === 'cancelled' ? 'neutral' : outstanding > 0.001 ? (due.tone === 'danger' ? 'danger' : 'warning') : 'success'}>
                <dt>Outstanding</dt><dd className="mn-id-outstanding">{money2(status === 'cancelled' ? 0 : outstanding)}</dd>
              </div>
            </dl>
          </Card>

          <Card title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> Transport (e-way bill)</span>}>
            <p className="mn-board-form-hint" style={{ margin: '0 0 12px' }}>
              Transporter, vehicle, mode and distance feed the e-way bill. If you generate the e-way bill yourself on the portal, put its number here: it prints on the challan and this invoice stops counting as pending.
            </p>
            {status === 'cancelled' ? (
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Transporter</dt><dd>{transporterName}</dd></div>
                <div><dt>Vehicle</dt><dd>{String(inv.vehicleNo ?? '—')}</dd></div>
                <div><dt>Mode</dt><dd>{String(inv.transportMode ?? '—')}</dd></div>
                <div><dt>Distance</dt><dd>{inv.distanceKm != null ? `${String(inv.distanceKm)} km` : '—'}</dd></div>
                <div><dt>E-way bill</dt><dd>{String(inv.ewayBillNo ?? '—')}</dd></div>
              </dl>
            ) : (
              <div className="mn-qd-details">
                <Field label="Transporter">
                  <select className="mn-input" value={tp.transporterId} onChange={(e) => setTp({ ...tp, transporterId: e.target.value })}>
                    <option value="">—</option>
                    {transporters.map((t) => (
                      <option key={String(t.id)} value={String(t.id)}>{String(t.transporterName)}</option>
                    ))}
                  </select>
                </Field>
                <div className="mn-id-two">
                  <Field label="Vehicle no">
                    <Input value={tp.vehicleNo} onChange={(e) => setTp({ ...tp, vehicleNo: e.target.value })} placeholder="e.g. TN01AB1234" />
                  </Field>
                  <Field label="Mode">
                    <select className="mn-input" value={tp.transportMode} onChange={(e) => setTp({ ...tp, transportMode: e.target.value })}>
                      <option value="">—</option>
                      {TRANSPORT_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="mn-id-two">
                  <Field label="Distance (km)">
                    <Input type="number" value={tp.distanceKm} onChange={(e) => setTp({ ...tp, distanceKm: e.target.value })} />
                  </Field>
                  <Field label="Valid until">
                    <Input type="date" value={tp.ewayValidUntil} onChange={(e) => setTp({ ...tp, ewayValidUntil: e.target.value })} disabled={eway === 'generated'} />
                  </Field>
                </div>
                <Field label="E-way bill no">
                  <Input value={tp.ewayBillNo} onChange={(e) => setTp({ ...tp, ewayBillNo: e.target.value })} placeholder="12 digits from the portal" disabled={eway === 'generated'} />
                </Field>
                <div className="mn-qd-details-submit"><Button variant="secondary" onClick={saveTransport} loading={busy}>Save transport</Button></div>
              </div>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><FileCheck2 size={16} aria-hidden /> GST compliance</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>E-invoice</dt><dd><StatusBadge status={einv} /></dd></div>
              {inv.irn ? <div><dt>IRN</dt><dd className="mn-id-wrap">{String(inv.irn)}</dd></div> : null}
              {inv.ackNumber ? <div><dt>Ack no</dt><dd>{String(inv.ackNumber)}</dd></div> : null}
              <div><dt>E-way bill</dt><dd><StatusBadge status={eway} /></dd></div>
              {inv.ewayBillNo ? <div><dt>E-way no</dt><dd>{String(inv.ewayBillNo)}</dd></div> : null}
              {inv.ewayValidUntil ? <div><dt>Valid until</dt><dd>{formatDate(String(inv.ewayValidUntil).slice(0, 10))}</dd></div> : null}
            </dl>
            {live ? (
              <div className="mn-id-gst-acts">
                {einv !== 'generated' && einv !== 'cancelled' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        if (!(await confirm({ title: 'Generate e-invoice (IRN)', message: 'File this invoice with the IRP now?', confirmLabel: 'Generate IRN' }))) return;
                        await gstApi.generateIrn(id);
                        setMsg('IRN generated — the invoice now carries the IRN.');
                      })
                    }
                  >
                    Generate IRN
                  </Button>
                )}
                {einv === 'generated' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        const reason = await prompt({
                          title: 'Cancel IRN',
                          message: 'IRN cancellation is allowed within 24 hours of generation. Choose a reason.',
                          label: 'Reason',
                          options: IRN_CANCEL_REASONS,
                          defaultValue: '3',
                          confirmLabel: 'Cancel IRN',
                        });
                        if (reason === null) return;
                        await gstApi.cancelIrn(id, reason);
                        setMsg('IRN cancelled.');
                      })
                    }
                  >
                    Cancel IRN
                  </Button>
                )}
                {eway !== 'generated' && eway !== 'cancelled' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        if (!(await confirm({ title: 'Generate e-way bill', message: 'File the e-way bill for this consignment now?', confirmLabel: 'Generate e-way' }))) return;
                        await gstApi.generateEway(id);
                        setMsg('E-way bill generated.');
                      })
                    }
                  >
                    Generate e-way bill
                  </Button>
                )}
                {eway === 'generated' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        const reason = await prompt({
                          title: 'Cancel e-way bill',
                          message: 'e-way cancellation is allowed within 24 hours of generation. Choose a reason.',
                          label: 'Reason',
                          options: EWAY_CANCEL_REASONS,
                          defaultValue: '2',
                          confirmLabel: 'Cancel e-way',
                        });
                        if (reason === null) return;
                        await gstApi.cancelEway(id, reason);
                        setMsg('E-way bill cancelled.');
                      })
                    }
                  >
                    Cancel e-way bill
                  </Button>
                )}
              </div>
            ) : (
              gstNotice && <p className="mn-board-form-hint">{gstNotice}</p>
            )}
          </Card>

          <Card title={<span className="mn-board-card-title"><Receipt size={16} aria-hidden /> Supply details</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Customer</dt><dd>{String(inv.customerName ?? '—')}</dd></div>
              <div><dt>GSTIN</dt><dd>{String(inv.gstin ?? 'Unregistered')}</dd></div>
              <div><dt>Place of supply</dt><dd>{String(inv.placeOfSupply ?? '—')}</dd></div>
              <div><dt>Supply</dt><dd>{inv.isInterstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</dd></div>
              {inv.siteName ? <div><dt>Site</dt><dd>{String(inv.siteName)}</dd></div> : null}
              {inv.billingAddress ? <div><dt>Billed to</dt><dd className="mn-id-wrap">{String(inv.billingAddress)}</dd></div> : null}
              <div><dt>Invoice date</dt><dd>{inv.invoiceDate ? formatDate(inv.invoiceDate) : '—'}</dd></div>
              <div><dt>Due date</dt><dd>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</dd></div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
