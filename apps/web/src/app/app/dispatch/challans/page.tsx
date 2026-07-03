'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { challansApi, type Row } from '../../../../lib/api';
import { card, ghostButton, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const badge = (s: string) => ({
  color: ({ draft: '#8aa0c6', issued: '#e0b341', delivered: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)',
  fontWeight: 600,
});

export default function ChallansPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { challansApi.list().then(setRows).catch((e) => setError(String(e))); }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Delivery Challans</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Challan No</th><th style={th}>Grade</th><th style={th}>Qty m³</th><th style={th}>Invoice</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.challanNo ?? '')}</td>
                <td style={td}>{String(r.gradeLabel ?? '—')}</td>
                <td style={td}>{money(r.quantityM3)}</td>
                <td style={td}>{String(r.invoiceStatus ?? '')}</td>
                <td style={td}><span style={badge(String(r.challanStatus))}>{String(r.challanStatus)}</span></td>
                <td style={td}><Link href={`/app/dispatch/challans/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={6}>No challans yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
