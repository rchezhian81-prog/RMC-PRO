'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invoicesApi, openPdf, type Row } from '../../../../../lib/api';
import { button, card, ghostButton, table, td, th } from '../../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const statusColor: Record<string, string> = { draft: '#8aa0c6', issued: '#6ee7a8', cancelled: '#ff8080' };

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => { setInv(await invoicesApi.get(id)); }, [id]);
  useEffect(() => { load().catch((e) => setError(String(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await load(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  if (!inv) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const items = (inv.items as Row[]) ?? [];
  const status = String(inv.invoiceStatus);
  const total = (label: string, v: unknown) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30 }}><span style={{ color: 'var(--muted)' }}>{label}</span><span>{money(v)}</span></div>
  );

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/billing/invoices')}>← Invoices</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(inv.invoiceNo)} <span style={{ fontSize: 13, color: statusColor[status] ?? 'var(--muted)' }}>{status} · {String(inv.paymentStatus)}</span>
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        {inv.isInterstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'} · Place of supply: {String(inv.placeOfSupply ?? '—')} · GSTIN: {String(inv.gstin ?? '—')}
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && <button style={button} onClick={() => run(() => invoicesApi.issue(id), 'Invoice issued')}>Issue</button>}
        <button style={ghostButton} onClick={() => openPdf(`/invoices/${id}/pdf`).catch((e) => setError(String(e)))}>Download PDF</button>
        <button style={ghostButton} onClick={() => run(async () => { const m = window.prompt('Recipient mobile', ''); if (m !== null) await invoicesApi.share(id, m); }, 'WhatsApp message logged')}>Share on WhatsApp</button>
        {status !== 'cancelled' && Number(inv.amountPaid) === 0 && (
          <button style={ghostButton} onClick={() => run(async () => { const r = window.prompt('Cancel reason', ''); if (r !== null) await invoicesApi.cancel(id, r); }, 'Invoice cancelled')}>Cancel</button>
        )}
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Line items</h3>
        <table style={table}>
          <thead><tr><th style={th}>Description</th><th style={th}>HSN/SAC</th><th style={th}>UOM</th><th style={th}>Qty</th><th style={th}>Rate</th><th style={th}>Taxable</th><th style={th}>GST%</th><th style={th}>Line total</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={td}>{String(it.description ?? '')}</td>
                <td style={td}>{String(it.hsnSac ?? '')}</td>
                <td style={td}>{String(it.uom ?? '')}</td>
                <td style={td}>{money(it.quantity)}</td>
                <td style={td}>{money(it.rate)}</td>
                <td style={td}>{money(it.taxableAmount)}</td>
                <td style={td}>{String(Number(it.gstRate))}</td>
                <td style={td}>{money(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ ...card, maxWidth: 360, marginLeft: 'auto' }}>
        {total('Taxable', inv.taxableAmount)}
        {Number(inv.cgstAmount) > 0 && total('CGST', inv.cgstAmount)}
        {Number(inv.sgstAmount) > 0 && total('SGST', inv.sgstAmount)}
        {Number(inv.igstAmount) > 0 && total('IGST', inv.igstAmount)}
        {Number(inv.cessAmount) > 0 && total('Cess', inv.cessAmount)}
        {Number(inv.roundOff) !== 0 && total('Round off', inv.roundOff)}
        <div style={{ borderTop: '1px solid #26314b', margin: '8px 0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>Total</span><span>₹{money(inv.totalAmount)}</span>
        </div>
        {total('Paid', inv.amountPaid)}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: Number(inv.outstandingAmount) > 0 ? '#e0b341' : '#6ee7a8' }}>
          <span>Outstanding</span><span>₹{money(inv.outstandingAmount)}</span>
        </div>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Compliance (ready-only)</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: 0 }}>
          E-invoice: {String(inv.einvoiceStatus)} · IRN: {String(inv.irn ?? '—')} &nbsp;|&nbsp; E-way bill: {String(inv.ewayStatus)} · No: {String(inv.ewayBillNo ?? '—')}
          <br />Fields are stored for a future GSTN / e-way API (Phase 3) — not generated here.
        </p>
      </section>
    </div>
  );
}
