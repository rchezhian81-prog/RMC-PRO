'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { crud, quotationsApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const badge = (s: string): React.CSSProperties => {
  const c: Record<string, string> = {
    draft: '#8aa0c6', submitted: '#e0b341', approved: '#6ee7a8', rejected: '#ff8080',
  };
  return { color: c[s] ?? 'var(--text)', fontWeight: 600 };
};

export default function QuotationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [form, setForm] = useState({ customerId: '', siteId: '', quotationDate: '', validUntil: '', paymentTerms: '' });
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [q, c, s] = await Promise.all([quotationsApi.list(), crud('customers').list(), crud('sites').list()]);
    setRows(q);
    setCustomers(c);
    setSites(s);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.customerId) delete payload.customerId;
      if (!payload.siteId) delete payload.siteId;
      await quotationsApi.create(payload);
      setForm({ customerId: '', siteId: '', quotationDate: '', validUntil: '', paymentTerms: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Quotations</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Quotation</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={lbl}>Customer</label>
            <select style={{ ...input, width: 200 }} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Site</label>
            <select style={{ ...input, width: 180 }} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">— select —</option>
              {sites.map((s) => <option key={s.id} value={String(s.id)}>{String(s.siteName)}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Date</label>
            <input type="date" style={input} value={form.quotationDate} onChange={(e) => setForm({ ...form, quotationDate: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>Valid until</label>
            <input type="date" style={input} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>Payment terms</label>
            <input style={{ ...input, width: 150 }} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
          </div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Quotation No</th>
              <th style={th}>Date</th>
              <th style={th}>Valid until</th>
              <th style={th}>Rev</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.quotationNo ?? '')}</td>
                <td style={td}>{String(r.quotationDate ?? '—')}</td>
                <td style={td}>{String(r.validUntil ?? '—')}</td>
                <td style={td}>{String(r.revisionNo ?? 0)}</td>
                <td style={td}><span style={badge(String(r.approvalStatus))}>{String(r.approvalStatus)}</span></td>
                <td style={td}>
                  <Link href={`/app/sales/quotations/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={6}>No quotations yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;
