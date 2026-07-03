'use client';

import { useEffect, useState } from 'react';
import { billingReportsApi, downloadTallyCsv, type Row } from '../../../../lib/api';
import { button, card, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function BillingReportsPage() {
  const [gst, setGst] = useState<Row | null>(null);
  const [sales, setSales] = useState<{ rows: Row[]; total: number; taxable: number; count: number } | null>(null);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [g, s, r] = await Promise.all([billingReportsApi.gstSummary(), billingReportsApi.salesRegister(), billingReportsApi.receiptsRegister()]);
      setGst(g); setSales(s); setReceipts(r);
    })().catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Billing Reports</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Tally export</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '0 0 8px' }}>Download a Tally-ready sales CSV (Phase-1 file export — no live Tally API).</p>
          <button style={button} onClick={() => downloadTallyCsv().then(() => setMsg('Tally CSV downloaded.')).catch((e) => setError(String(e)))}>Download Tally CSV</button>
        </div>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>GST summary (issued invoices)</h3>
        {gst && (
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            {(['taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const).map((k) => (
              <div key={k}><div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{k}</div><div style={{ fontSize: 16, fontWeight: 600 }}>{money(gst[k])}</div></div>
            ))}
          </div>
        )}
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Sales register{sales ? ` — ${sales.count} invoices · taxable ₹${money(sales.taxable)} · total ₹${money(sales.total)}` : ''}</h3>
        <table style={table}>
          <thead><tr><th style={th}>Invoice</th><th style={th}>Date</th><th style={th}>Taxable</th><th style={th}>CGST</th><th style={th}>SGST</th><th style={th}>IGST</th><th style={th}>Total</th></tr></thead>
          <tbody>
            {(sales?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.invoiceNo)}</td>
                <td style={td}>{String(r.invoiceDate ?? '—')}</td>
                <td style={td}>{money(r.taxableAmount)}</td>
                <td style={td}>{money(r.cgstAmount)}</td>
                <td style={td}>{money(r.sgstAmount)}</td>
                <td style={td}>{money(r.igstAmount)}</td>
                <td style={td}>{money(r.totalAmount)}</td>
              </tr>
            ))}
            {!sales?.rows?.length && <tr><td style={td} colSpan={7}>No issued invoices.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Receipts register</h3>
        <table style={table}>
          <thead><tr><th style={th}>Receipt</th><th style={th}>Date</th><th style={th}>Mode</th><th style={th}>Amount</th><th style={th}>Allocated</th></tr></thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.receiptNo)}</td>
                <td style={td}>{String(r.receiptDate ?? '—')}</td>
                <td style={td}>{String(r.paymentMode ?? '')}</td>
                <td style={td}>{money(r.amount)}</td>
                <td style={td}>{money(r.allocatedAmount)}</td>
              </tr>
            ))}
            {!receipts.length && <tr><td style={td} colSpan={5}>No receipts.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
