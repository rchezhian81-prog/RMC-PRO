'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { crud, invoicesApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const badge = (s: string) => ({ color: ({ draft: '#8aa0c6', issued: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)', fontWeight: 600 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

interface LineForm { challanId: string; challanNo: string; quantity: number; hsnSac: string; uom: string; rate: string; gstRate: string; }

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([]);
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [inv, c] = await Promise.all([invoicesApi.list(), crud('customers').list()]);
    setRows(inv); setCustomers(c);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function loadBillable(cid: string) {
    setCustomerId(cid);
    setLines([]);
    setError(null); setMsg(null);
    if (!cid) return;
    try {
      const challans = await invoicesApi.billableChallans(cid);
      setLines(challans.map((c) => ({ challanId: String(c.id), challanNo: String(c.challanNo), quantity: Number(c.quantityM3), hsnSac: '68109990', uom: 'm3', rate: '', gstRate: '18' })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null); setMsg(null);
    const use = lines.filter((l) => Number(l.rate) > 0);
    if (!customerId || !use.length) { setError('Pick a customer and set a rate on at least one challan'); return; }
    try {
      const inv = await invoicesApi.fromChallans({
        customerId, invoiceDate: invoiceDate || undefined, dueDate: dueDate || undefined,
        lines: use.map((l) => ({ challanId: l.challanId, hsnSac: l.hsnSac, uom: l.uom, rate: Number(l.rate), gstRate: Number(l.gstRate) })),
      });
      router.push(`/app/billing/invoices/${inv.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Invoices</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Generate a GST tax invoice from delivered challans. Challans flip to invoiced on creation.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New invoice from delivered challans</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div><label style={lbl}>Customer</label>
            <select style={{ ...input, width: 220 }} value={customerId} onChange={(e) => loadBillable(e.target.value)}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Invoice date</label><input type="date" style={input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div><label style={lbl}>Due date</label><input type="date" style={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>

        {customerId && (
          lines.length ? (
            <>
              <table style={table}>
                <thead><tr><th style={th}>Challan</th><th style={th}>Qty</th><th style={th}>HSN/SAC</th><th style={th}>UOM</th><th style={th}>Rate</th><th style={th}>GST%</th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.challanId}>
                      <td style={td}>{l.challanNo}</td>
                      <td style={td}>{money(l.quantity)}</td>
                      <td style={td}><input style={{ ...input, width: 100 }} value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} /></td>
                      <td style={td}><input style={{ ...input, width: 60 }} value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} /></td>
                      <td style={td}><input type="number" step="any" style={{ ...input, width: 90 }} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                      <td style={td}><input type="number" step="any" style={{ ...input, width: 70 }} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button style={{ ...button, marginTop: 12 }} onClick={create}>Create invoice</button>
            </>
          ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>No delivered, un-invoiced challans for this customer.</p>
        )}
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Invoice No</th><th style={th}>Date</th><th style={th}>Taxable</th><th style={th}>Total</th><th style={th}>Outstanding</th><th style={th}>Payment</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.invoiceNo ?? '')}</td>
                <td style={td}>{String(r.invoiceDate ?? '—')}</td>
                <td style={td}>{money(r.taxableAmount)}</td>
                <td style={td}>{money(r.totalAmount)}</td>
                <td style={td}>{money(r.outstandingAmount)}</td>
                <td style={td}>{String(r.paymentStatus ?? '')}</td>
                <td style={td}><span style={badge(String(r.invoiceStatus))}>{String(r.invoiceStatus)}</span></td>
                <td style={td}><Link href={`/app/billing/invoices/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={8}>No invoices yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
