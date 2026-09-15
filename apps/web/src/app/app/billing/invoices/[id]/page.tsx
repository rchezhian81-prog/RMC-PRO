'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { invoicesApi, gstApi, crud, creditNotesApi, openPdf, type GstStatus, type Row, openWhatsAppShare } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Field, Input } from '../../../../../components/ui/Field';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { getAccess } from '../../../../../lib/session';
import { formatDate } from '../../../../../lib/format-date';

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

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

function TotalRow({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, fontWeight: strong ? 700 : 400, color: tone ?? 'inherit', padding: '3px 0' }}>
      {/* Label yields (ellipsis) when the row is tight so the ₹ value is never
          clipped on narrow phones; on wide cards space-between keeps them apart
          exactly as before. */}
      <span style={{ color: tone ?? 'var(--mn-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      // An action may return the sentence to show (a share says where the
      // message went); a fixed okMsg still wins when the caller gives one.
      const out = await fn();
      await load();
      if (okMsg) setMsg(okMsg);
      else if (typeof out === 'string' && out) setMsg(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
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
      return `${noteForm.noteType === 'debit' ? 'Debit' : 'Credit'} note drafted for ₹${money(n.totalAmount)} — issue it below to make it count.`;
    });
  }

  if (!inv) return error ? <ErrorState message={error} /> : <Loading label="Loading invoice…" />;
  const items = (inv.items as Row[]) ?? [];
  const status = String(inv.invoiceStatus);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/billing/invoices')}>
          Invoices
        </Button>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Unnumbered until issued — String(null) would read "null" here. */}
          <h1 style={{ fontSize: 24, margin: 0 }}>{inv.invoiceNo ? String(inv.invoiceNo) : 'Draft invoice'}</h1>
          <StatusBadge status={status} />
          <StatusBadge status={String(inv.paymentStatus)} />
        </div>
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '6px 0 0' }}>
          {inv.isInterstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'} · Place of supply: {String(inv.placeOfSupply ?? '—')} · GSTIN: {String(inv.gstin ?? '—')}
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      <Card title="Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'draft' && <Button onClick={() => run(() => invoicesApi.issue(id), 'Invoice issued')}>Issue</Button>}
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openPdf(`/invoices/${id}/pdf`, String(inv.invoiceNo ?? 'Draft invoice')).catch((e) => setError(String(e)))}>
            Print / PDF
          </Button>
          <Button
            variant="secondary"
            icon={<Share2 size={16} />}
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
          {status !== 'cancelled' && Number(inv.amountPaid) === 0 && (
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const r = await prompt({ title: 'Cancel invoice', label: 'Cancel reason', defaultValue: '' });
                  if (r !== null) await invoicesApi.cancel(id, r);
                }, 'Invoice cancelled')
              }
            >
              Cancel
            </Button>
          )}
          {status === 'issued' && Number(inv.outstandingAmount) > 0 && getAccess().has('invoice_cancellation.approve') && (
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
          {status === 'issued' && Number(inv.writtenOffAmount) > 0 && getAccess().has('invoice_cancellation.approve') && (
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
        </div>
      </Card>

      {noteForm?.open && (
        <Card title={noteForm.noteType === 'debit' ? 'New debit note' : 'New credit note'}>
          <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>
            {noteForm.noteType === 'debit'
              ? 'What is being added to this invoice — an extra charge, an under-billed quantity or rate.'
              : 'What is being credited back — set each line to the quantity and rate being credited, and remove lines that are not.'}
            {' '}The note is a draft until it is issued.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ minWidth: 220 }}>
              <Field label="Reason">
                <select className="mn-input" value={noteForm.reason} onChange={(e) => setNoteForm({ ...noteForm, reason: e.target.value })}>
                  {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 320, flex: 1 }}>
              <Field label="Remarks (printed on the note)">
                <Input value={noteForm.remarks} onChange={(e) => setNoteForm({ ...noteForm, remarks: e.target.value })} />
              </Field>
            </div>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button variant="secondary" onClick={() => setNoteForm({ ...noteForm, lines: [...noteForm.lines, { description: '', hsnSac: '', uom: '', quantity: '', rate: '', gstRate: '18' }] })}>Add line</Button>
            <Button onClick={createNote}>Create draft</Button>
            <Button variant="ghost" onClick={() => setNoteForm(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {notes.length > 0 && (
        <Card title="Credit / debit notes against this invoice" padded={false}>
          <Table>
            <thead>
              <tr><Th>Note</Th><Th>Type</Th><Th>Date</Th><Th>Reason</Th><Th numeric>Total</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const nid = String(n.id); const nst = String(n.status); const no = String(n.noteNo ?? '');
                return (
                  <tr key={nid}>
                    <Td style={{ fontWeight: 600 }}>{no || 'Draft'}</Td>
                    <Td>{n.noteType === 'debit' ? 'Debit' : 'Credit'}</Td>
                    <Td>{formatDate(n.noteDate)}</Td>
                    <Td>{String(n.reason ?? '—').replace(/_/g, ' ')}</Td>
                    <Td numeric>₹{money(n.totalAmount)}</Td>
                    <Td><StatusBadge status={nst} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => openPdf(`/credit-notes/${nid}/pdf`, no || 'Draft note').catch((e) => setError(String(e)))}>Print</Button>
                        {getAccess().has('invoice_cancellation.approve') && nst === 'draft' && (
                          <Button size="sm" onClick={async () => {
                            if (!(await confirm({ title: 'Issue note', message: `Issue this note for ₹${money(n.totalAmount)}? It takes a number and changes what the customer owes.`, confirmLabel: 'Issue' }))) return;
                            run(() => creditNotesApi.issue(nid), 'Note issued.');
                          }}>Issue</Button>
                        )}
                        {getAccess().has('invoice_cancellation.approve') && nst !== 'cancelled' && (
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
          <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: 0, padding: '10px 14px' }}>
            All notes: <Link href="/app/billing/credit-notes">Billing → Credit notes</Link>.
          </p>
        </Card>
      )}

      <Card title="Line items" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Description</Th>
              <Th>HSN/SAC</Th>
              <Th>UOM</Th>
              <Th numeric>Qty</Th>
              <Th numeric>Rate</Th>
              <Th numeric>Taxable</Th>
              <Th numeric>GST%</Th>
              <Th numeric>Line total</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <Td>{String(it.description ?? '')}</Td>
                <Td>{String(it.hsnSac ?? '')}</Td>
                <Td>{String(it.uom ?? '')}</Td>
                <Td numeric>{money(it.quantity)}</Td>
                <Td numeric>{money(it.rate)}</Td>
                <Td numeric>{money(it.taxableAmount)}</Td>
                <Td numeric>{String(Number(it.gstRate))}</Td>
                <Td numeric>{money(it.lineTotal)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card style={{ maxWidth: 380, marginLeft: 'auto', width: '100%' }}>
        <TotalRow label="Taxable" value={money(inv.taxableAmount)} />
        {Number(inv.cgstAmount) > 0 && <TotalRow label="CGST" value={money(inv.cgstAmount)} />}
        {Number(inv.sgstAmount) > 0 && <TotalRow label="SGST" value={money(inv.sgstAmount)} />}
        {Number(inv.igstAmount) > 0 && <TotalRow label="IGST" value={money(inv.igstAmount)} />}
        {Number(inv.cessAmount) > 0 && <TotalRow label="Cess" value={money(inv.cessAmount)} />}
        {Number(inv.roundOff) !== 0 && <TotalRow label="Round off" value={money(inv.roundOff)} />}
        <div style={{ borderTop: '1px solid var(--mn-border)', margin: '8px 0', paddingTop: 8 }}>
          <TotalRow label="Total" value={`₹${money(inv.totalAmount)}`} strong />
        </div>
        <TotalRow label="Paid" value={money(inv.amountPaid)} />
        {Number(inv.writtenOffAmount) > 0 && <TotalRow label="Written off" value={money(inv.writtenOffAmount)} tone="var(--mn-danger)" />}
        <TotalRow
          label="Outstanding"
          value={`₹${money(inv.outstandingAmount)}`}
          strong
          tone={Number(inv.outstandingAmount) > 0 ? 'var(--mn-warning)' : 'var(--mn-success)'}
        />
      </Card>

      <Card title="Transport (e-way bill)">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>
          Transporter, vehicle, mode and distance for this consignment — these feed the e-way bill.
          If you generate the e-way bill yourself on the government portal, put its number here: it
          then prints on the delivery challan, and this invoice stops being counted as pending.
        </p>
        {status === 'cancelled' ? (
          <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
            Transporter: {String(inv.transporterId ? (transporters.find((t) => String(t.id) === String(inv.transporterId))?.transporterName ?? '—') : '—')}
            {' · '}Vehicle: {String(inv.vehicleNo ?? '—')}
            {' · '}Mode: {String(inv.transportMode ?? '—')}
            {' · '}Distance: {inv.distanceKm != null ? `${String(inv.distanceKm)} km` : '—'}
            {' · '}E-way bill: {String(inv.ewayBillNo ?? '—')}
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 200 }}>
              <Field label="Transporter">
                <select className="mn-input" value={tp.transporterId} onChange={(e) => setTp({ ...tp, transporterId: e.target.value })}>
                  <option value="">—</option>
                  {transporters.map((t) => (
                    <option key={t.id} value={String(t.id)}>{String(t.transporterName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Vehicle no">
                <Input value={tp.vehicleNo} onChange={(e) => setTp({ ...tp, vehicleNo: e.target.value })} placeholder="e.g. TN01AB1234" />
              </Field>
            </div>
            <div style={{ minWidth: 120 }}>
              <Field label="Mode">
                <select className="mn-input" value={tp.transportMode} onChange={(e) => setTp({ ...tp, transportMode: e.target.value })}>
                  <option value="">—</option>
                  {TRANSPORT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 110 }}>
              <Field label="Distance (km)">
                <Input type="number" value={tp.distanceKm} onChange={(e) => setTp({ ...tp, distanceKm: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 170 }}>
              <Field label="E-way bill no">
                <Input
                  value={tp.ewayBillNo}
                  onChange={(e) => setTp({ ...tp, ewayBillNo: e.target.value })}
                  placeholder="12 digits from the portal"
                  disabled={String(inv.ewayStatus) === 'generated'}
                />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label="Valid until">
                <Input
                  type="date"
                  value={tp.ewayValidUntil}
                  onChange={(e) => setTp({ ...tp, ewayValidUntil: e.target.value })}
                  disabled={String(inv.ewayStatus) === 'generated'}
                />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button variant="secondary" onClick={saveTransport}>Save transport</Button>
            </div>
          </div>
        )}
      </Card>

      {(() => {
        const einv = String(inv.einvoiceStatus);
        const eway = String(inv.ewayStatus);
        const canGst = getAccess().has('agents.manage') && getAccess().has('agents.approve');
        const issued = status !== 'draft' && status !== 'cancelled';
        const live = Boolean(gst?.configured) && canGst && issued;
        const notice = !gst?.configured
          ? 'GST transmission is not enabled — the fields below are stored but not filed with the portal.'
          : !canGst
            ? 'You do not have permission to file GST documents (needs agents.manage + agents.approve).'
            : !issued
              ? 'Issue the invoice before filing its e-invoice / e-way bill.'
              : null;

        return (
          <Card title="GST compliance">
            <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: 0 }}>
              E-invoice: <strong style={{ color: 'var(--mn-text)' }}>{einv}</strong> · IRN: {String(inv.irn ?? '—')}
              &nbsp;|&nbsp; E-way bill: <strong style={{ color: 'var(--mn-text)' }}>{eway}</strong> · No: {String(inv.ewayBillNo ?? '—')}
            </p>
            {live ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {einv !== 'generated' && einv !== 'cancelled' && (
                  <Button
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
              notice && <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '8px 0 0' }}>{notice}</p>
            )}
          </Card>
        );
      })()}
    </div>
  );
}
