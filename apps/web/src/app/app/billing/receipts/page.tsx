'use client';

import { useEffect, useState } from 'react';
import { crud, invoicesApi, receiptsApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function ReceiptsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [openInvoices, setOpenInvoices] = useState<Row[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ amount: '', paymentMode: 'neft', receiptDate: '', bankReference: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [r, c] = await Promise.all([receiptsApi.list(), crud('customers').list()]);
    setRows(r); setCustomers(c);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function pickCustomer(cid: string) {
    setCustomerId(cid); setAlloc({}); setError(null); setMsg(null);
    if (!cid) { setOpenInvoices([]); return; }
    const all = await invoicesApi.list('issued');
    setOpenInvoices(all.filter((i) => i.customerId === cid && Number(i.outstandingAmount) > 0));
  }

  async function create() {
    setError(null); setMsg(null);
    const allocations = openInvoices
      .map((i) => ({ invoiceId: String(i.id), amount: Number(alloc[String(i.id)] || 0) }))
      .filter((a) => a.amount > 0);
    try {
      const r = await receiptsApi.create({
        customerId, amount: Number(form.amount || 0), paymentMode: form.paymentMode,
        receiptDate: form.receiptDate || undefined, bankReference: form.bankReference || undefined, allocations,
      });
      setMsg(`Receipt ${String(r.receiptNo)} recorded (allocated ₹${money(r.allocatedAmount)}, unallocated ₹${money(r.unallocatedAmount)}).`);
      setForm({ amount: '', paymentMode: 'neft', receiptDate: '', bankReference: '' });
      setCustomerId(''); setOpenInvoices([]); setAlloc({});
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Receipts</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Record a customer payment and allocate it against outstanding invoices.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New receipt</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div><label style={lbl}>Customer</label>
            <select style={{ ...input, width: 200 }} value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Amount</label><input type="number" step="any" style={{ ...input, width: 120 }} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label style={lbl}>Mode</label>
            <select style={{ ...input, width: 110 }} value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
              {['neft', 'rtgs', 'upi', 'cheque', 'cash'].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Date</label><input type="date" style={input} value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} /></div>
          <div><label style={lbl}>Bank ref</label><input style={{ ...input, width: 120 }} value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} /></div>
        </div>

        {customerId && (openInvoices.length ? (
          <>
            <table style={table}>
              <thead><tr><th style={th}>Invoice</th><th style={th}>Total</th><th style={th}>Outstanding</th><th style={th}>Allocate</th></tr></thead>
              <tbody>
                {openInvoices.map((i) => (
                  <tr key={i.id}>
                    <td style={td}>{String(i.invoiceNo)}</td>
                    <td style={td}>{money(i.totalAmount)}</td>
                    <td style={td}>{money(i.outstandingAmount)}</td>
                    <td style={td}><input type="number" step="any" style={{ ...input, width: 110 }} value={alloc[String(i.id)] ?? ''} onChange={(e) => setAlloc({ ...alloc, [String(i.id)]: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={{ ...button, marginTop: 12 }} onClick={create}>Record receipt</button>
          </>
        ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>No outstanding invoices for this customer.</p>)}
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Receipt No</th><th style={th}>Date</th><th style={th}>Mode</th><th style={th}>Amount</th><th style={th}>Allocated</th><th style={th}>Unallocated</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.receiptNo ?? '')}</td>
                <td style={td}>{String(r.receiptDate ?? '—')}</td>
                <td style={td}>{String(r.paymentMode ?? '')}</td>
                <td style={td}>{money(r.amount)}</td>
                <td style={td}>{money(r.allocatedAmount)}</td>
                <td style={td}>{money(r.unallocatedAmount)}</td>
                <td style={td}><button style={ghostButton} onClick={async () => { const m = window.prompt('Recipient mobile', ''); if (m !== null) { await receiptsApi.share(String(r.id), m); setMsg('WhatsApp message logged.'); } }}>Share</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={7}>No receipts yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
