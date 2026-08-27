'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { billingReportsApi, downloadTallyCsv, type SalesRegister, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function BillingReportsPage() {
  const [gst, setGst] = useState<Row | null>(null);
  const [sales, setSales] = useState<SalesRegister | null>(null);
  const [hsn, setHsn] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [g, s, h, r] = await Promise.all([
      billingReportsApi.gstSummary(from || undefined, to || undefined),
      billingReportsApi.salesRegister(from || undefined, to || undefined),
      billingReportsApi.hsnSummary(from || undefined, to || undefined),
      billingReportsApi.receiptsRegister(from || undefined, to || undefined),
    ]);
    setGst(g); setSales(s); setHsn(h); setReceipts(r);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const b2b = sales?.summary?.b2b;
  const b2c = sales?.summary?.b2c;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Billing Reports</h1>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && (
            <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>
          )}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Filters the GST summary, HSN summary, sales register and receipts. Leave blank for all-time.</span>
        </div>
      </Card>

      <Card title="Tally export">
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>Download a Tally-ready sales CSV (Phase-1 file export — no live Tally API).</p>
        <Button icon={<Download size={16} />} onClick={() => downloadTallyCsv().then(() => setMsg('Tally CSV downloaded.')).catch((e) => setError(String(e)))}>
          Download Tally CSV
        </Button>
      </Card>

      <Card title="GST summary (issued invoices)" actions={gst ? <ExportButton rows={[gst]} columns={['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="gst-summary" /> : null}>
        {gst && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {(['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const).map((k) => (
              <StatCard key={k} label={k} value={money(gst[k])} tone={k === 'total' ? 'info' : 'neutral'} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="HSN / SAC summary (GSTR-1 Table 12)"
        padded={false}
        actions={<ExportButton rows={hsn?.rows ?? []} columns={['hsn', 'gstRate', 'quantity', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total']} filename="hsn-summary" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : hsn?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>HSN/SAC</Th>
                <Th numeric>Rate %</Th>
                <Th numeric>Qty</Th>
                <Th numeric>Taxable</Th>
                <Th numeric>CGST</Th>
                <Th numeric>SGST</Th>
                <Th numeric>IGST</Th>
                <Th numeric>Cess</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {hsn.rows.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r.hsn)}</Td>
                  <Td numeric>{qty(r.gstRate)}</Td>
                  <Td numeric>{qty(r.quantity)}</Td>
                  <Td numeric>{money(r.taxable)}</Td>
                  <Td numeric>{money(r.cgst)}</Td>
                  <Td numeric>{money(r.sgst)}</Td>
                  <Td numeric>{money(r.igst)}</Td>
                  <Td numeric>{money(r.cess)}</Td>
                  <Td numeric>{money(r.total)}</Td>
                </tr>
              ))}
            </tbody>
            {hsn.totals && (
              <tfoot>
                <tr>
                  <Td style={{ fontWeight: 700 }}>All HSN</Td>
                  <Td />
                  <Td numeric style={{ fontWeight: 700 }}>{qty(hsn.totals.quantity)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.taxable)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.cgst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.sgst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.igst)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.cess)}</Td>
                  <Td numeric style={{ fontWeight: 700 }}>{money(hsn.totals.total)}</Td>
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <EmptyState title="No line items" description="Issued invoices in the period will summarise here by HSN and rate." />
        )}
      </Card>

      {b2b && b2c && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard label="B2B (registered)" value={money(b2b.total)} tone="info" />
          <StatCard label="B2B invoices" value={String(b2b.count)} />
          <StatCard label="B2C (unregistered)" value={money(b2c.total)} tone="neutral" />
          <StatCard label="B2C invoices" value={String(b2c.count)} />
        </div>
      )}

      <Card
        title={`Sales register${sales ? ` — ${sales.count} invoices · taxable ${money(sales.taxable)} · total ${money(sales.total)}` : ''}`}
        padded={false}
        actions={
          <ExportButton
            rows={sales?.rows ?? []}
            columns={['invoiceNo', 'invoiceDate', 'gstin', 'placeOfSupply', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'totalAmount']}
            filename="sales-register"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : sales?.rows?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>GSTIN</Th>
                  <Th>Place of supply</Th>
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
                    <Td>{r.gstin ? String(r.gstin) : <span style={{ color: 'var(--mn-muted)' }}>B2C</span>}</Td>
                    <Td>{String(r.placeOfSupply ?? '—')}</Td>
                    <Td numeric>{money(r.taxableAmount)}</Td>
                    <Td numeric>{money(r.cgstAmount)}</Td>
                    <Td numeric>{money(r.sgstAmount)}</Td>
                    <Td numeric>{money(r.igstAmount)}</Td>
                    <Td numeric>{money(r.totalAmount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
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
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : receipts.length ? (
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
