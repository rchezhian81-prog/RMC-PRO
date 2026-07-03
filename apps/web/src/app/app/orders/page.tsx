'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ordersApi, type Row } from '../../../lib/api';
import { card, ghostButton, input, table, td, th } from '../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const statusColor: Record<string, string> = {
  draft: '#8aa0c6', confirmed: '#6ee7a8', credit_hold: '#e0b341', cancelled: '#ff8080',
};
const badge = (s: string) => ({ color: statusColor[s] ?? 'var(--text)', fontWeight: 600 });

const FILTERS = ['', 'draft', 'confirmed', 'credit_hold', 'cancelled'];

export default function OrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await ordersApi.list(filter || undefined));
  }, [filter]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Orders</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Confirm draft orders (credit-checked at booking). Over-limit bookings are blocked to a credit
        hold for approval. Production &amp; dispatch are later sprints.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Status</label>
          <select style={{ ...input, width: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => <option key={f} value={f}>{f === '' ? 'All' : f}</option>)}
          </select>
        </div>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Order No</th>
              <th style={th}>Source</th>
              <th style={th}>Order date</th>
              <th style={th}>Est. value</th>
              <th style={th}>Credit</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.orderNo ?? '')}</td>
                <td style={td}>{String(r.pricingSource ?? '—')}</td>
                <td style={td}>{String(r.orderDate ?? '—')}</td>
                <td style={td}>{money(r.estimatedOrderValue)}</td>
                <td style={td}>{String(r.creditStatus ?? '')}</td>
                <td style={td}><span style={badge(String(r.orderStatus))}>{String(r.orderStatus)}</span></td>
                <td style={td}>
                  <Link href={`/app/orders/${r.id}`} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={7}>No orders.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
