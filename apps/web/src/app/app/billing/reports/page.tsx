'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { billingReportsApi, downloadTallyCsv, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function BillingReportsPage() {
  const [gst, setGst] = useState<Row | null>(null);
  const [sales, setSales] = useState<{ rows: Row[]; total: number; taxable: number; count: number } | null>(null);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [g, s, r] = await Promise.all([billingReportsApi.gstSummary(), billingReportsApi.salesRegister(), billingReportsApi.receiptsRegister()]);
      setGst(g);
      setSales(s);
      setReceipts(r);
    })().catch((e) => setError(String(e)));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Billing Reports</h1>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="Tally export">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>Download a Tally-ready sales CSV (Phase-1 file export — no live Tally API).</p>
        <Button icon={<Download size={16} />} onClick={() => downloadTallyCsv().then(() => setMsg('Tally CSV downloaded.')).catch((e) => setError(String(e)))}>
          Download Tally CSV
        </Button>
      </Card>

      <Card title="GST summary (issued invoices)">
        {gst && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {(['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const).map((k) => (
              <StatCard key={k} label={k} value={money(gst[k])} tone={k === 'total' ? 'info' : 'neutral'} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title={`Sales register${sales ? ` — ${sales.count} invoices · taxable ${money(sales.taxable)} · total ${money(sales.total)}` : ''}`}
        padded={false}
        actions={
          <ExportButton
            rows={sales?.rows ?? []}
            columns={['invoiceNo', 'invoiceDate', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'totalAmount']}
            filename="sales-register"
          />
        }
      >
        {sales?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th numeric>Taxable</Th>
                <Th numeric>CGST</Th>
                <Th numeric>SGST</Th>
                <Th numeric>IGST</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {sales.rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.invoiceNo)}</Td>
                  <Td>{String(r.invoiceDate ?? '—')}</Td>
                  <Td numeric>{money(r.taxableAmount)}</Td>
                  <Td numeric>{money(r.cgstAmount)}</Td>
                  <Td numeric>{money(r.sgstAmount)}</Td>
                  <Td numeric>{money(r.igstAmount)}</Td>
                  <Td numeric>{money(r.totalAmount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No issued invoices" />
        )}
      </Card>

      <Card
        title="Receipts register"
        padded={false}
        actions={
          <ExportButton
            rows={receipts}
            columns={['receiptNo', 'receiptDate', 'paymentMode', 'amount', 'allocatedAmount']}
            filename="receipts-register"
          />
        }
      >
        {receipts.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Date</Th>
                <Th>Mode</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Allocated</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.receiptNo)}</Td>
                  <Td>{String(r.receiptDate ?? '—')}</Td>
                  <Td>{String(r.paymentMode ?? '')}</Td>
                  <Td numeric>{money(r.amount)}</Td>
                  <Td numeric>{money(r.allocatedAmount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No receipts" />
        )}
      </Card>
    </div>
  );
}
