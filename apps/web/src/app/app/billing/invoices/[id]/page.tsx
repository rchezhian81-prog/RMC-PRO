'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { invoicesApi, gstApi, openPdf, type GstStatus, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Loading, ErrorState } from '../../../../../components/ui/States';
import { useConfirm } from '../../../../../components/ui/ConfirmDialog';
import { getAccess } from '../../../../../lib/session';

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
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInv(await invoicesApi.get(id));
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
    // Best-effort: unavailable (403 for non-agents users) → no live GST actions.
    gstApi.status().then(setGst).catch(() => setGst(null));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
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
          <h1 style={{ fontSize: 24, margin: 0 }}>{String(inv.invoiceNo)}</h1>
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
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => openPdf(`/invoices/${id}/pdf`).catch((e) => setError(String(e)))}>
            Download PDF
          </Button>
          <Button
            variant="secondary"
            icon={<Share2 size={16} />}
            onClick={() =>
              run(async () => {
                const m = await prompt({ title: 'Share on WhatsApp', label: 'Recipient mobile', defaultValue: '' });
                if (m !== null) await invoicesApi.share(id, m);
              }, 'WhatsApp message logged')
            }
          >
            Share on WhatsApp
          </Button>
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
        </div>
      </Card>

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
