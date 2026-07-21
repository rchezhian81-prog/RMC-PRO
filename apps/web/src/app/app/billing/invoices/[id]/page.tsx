'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { invoicesApi, openPdf, type Row } from '../../../../../lib/api';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { StatusBadge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Loading, ErrorState } from '../../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

function TotalRow({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30, fontWeight: strong ? 700 : 400, color: tone ?? 'inherit', padding: '3px 0' }}>
      <span style={{ color: tone ?? 'var(--mn-muted)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInv(await invoicesApi.get(id));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (!inv) return <Loading label="Loading invoice…" />;
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
                const m = window.prompt('Recipient mobile', '');
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
                  const r = window.prompt('Cancel reason', '');
                  if (r !== null) await invoicesApi.cancel(id, r);
                }, 'Invoice cancelled')
              }
            >
              Cancel
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
        <TotalRow
          label="Outstanding"
          value={`₹${money(inv.outstandingAmount)}`}
          strong
          tone={Number(inv.outstandingAmount) > 0 ? 'var(--mn-warning)' : 'var(--mn-success)'}
        />
      </Card>

      <Card title="Compliance (read-only)">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: 0 }}>
          E-invoice: {String(inv.einvoiceStatus)} · IRN: {String(inv.irn ?? '—')} &nbsp;|&nbsp; E-way bill: {String(inv.ewayStatus)} · No: {String(inv.ewayBillNo ?? '—')}
          <br />
          Fields are stored for a future GSTN / e-way API (Phase 3) — not generated here.
        </p>
      </Card>
    </div>
  );
}
