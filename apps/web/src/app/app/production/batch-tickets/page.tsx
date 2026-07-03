'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { batchTicketsApi, type Row } from '../../../../lib/api';
import { card, ghostButton, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const badge = (s: string) => ({
  color: ({ draft: '#8aa0c6', confirmed: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)',
  fontWeight: 600,
});

export default function BatchTicketsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { batchTicketsApi.list().then(setRows).catch((e) => setError(String(e))); }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Batch Tickets</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Manual batch production records. Confirming reduces inventory from actual consumption.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Batch No</th><th style={th}>Grade</th><th style={th}>Qty m³</th><th style={th}>Variance</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.batchTicketNo ?? '')}</td>
                <td style={td}>{String(r.gradeLabel ?? '—')}</td>
                <td style={td}>{money(r.batchQuantityM3)}</td>
                <td style={td}>{r.varianceExceeded ? <span style={{ color: '#e0b341', fontWeight: 600 }}>exceeded</span> : <span style={{ color: '#6ee7a8' }}>ok</span>}</td>
                <td style={td}><span style={badge(String(r.status))}>{String(r.status)}</span></td>
                <td style={td}><Link href={`/app/production/batch-tickets/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={6}>No batch tickets yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
