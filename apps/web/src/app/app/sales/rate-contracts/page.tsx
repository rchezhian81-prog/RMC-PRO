'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { crud, rateContractsApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const badge = (s: string): React.CSSProperties => {
  const c: Record<string, string> = { draft: '#8aa0c6', submitted: '#e0b341', approved: '#6ee7a8', rejected: '#ff8080' };
  return { color: c[s] ?? 'var(--text)', fontWeight: 600 };
};

export default function RateContractsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [form, setForm] = useState({ customerId: '', validFrom: '', validTo: '', paymentTerms: '', transportTerms: '' });
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [rc, c] = await Promise.all([rateContractsApi.list(), crud('customers').list()]);
    setRows(rc);
    setCustomers(c);
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
      await rateContractsApi.create(payload);
      setForm({ customerId: '', validFrom: '', validTo: '', paymentTerms: '', transportTerms: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Rate Contracts</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Rate Contract</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={lbl}>Customer</label>
            <select style={{ ...input, width: 200 }} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={String(c.id)}>{String(c.customerName)}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Valid from</label>
            <input type="date" style={input} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>Valid to</label>
            <input type="date" style={input} value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
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
              <th style={th}>Contract No</th>
              <th style={th}>Valid from</th>
              <th style={th}>Valid to</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.rateContractNo ?? '')}</td>
                <td style={td}>{String(r.validFrom ?? '—')}</td>
                <td style={td}>{String(r.validTo ?? '—')}</td>
                <td style={td}><span style={badge(String(r.approvalStatus))}>{String(r.approvalStatus)}</span></td>
                <td style={td}>
                  <Link href={`/app/sales/rate-contracts/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={5}>No rate contracts yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;
