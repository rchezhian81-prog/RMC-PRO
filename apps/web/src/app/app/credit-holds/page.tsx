'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { creditHoldsApi, type Row } from '../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const statusColor: Record<string, string> = {
  pending: '#e0b341', approved: '#6ee7a8', rejected: '#ff8080', cancelled: '#8aa0c6',
};
const FILTERS = ['pending', '', 'approved', 'rejected'];

export default function CreditHoldsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await creditHoldsApi.list(filter || undefined));
  }, [filter]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  async function decide(id: string, approve: boolean) {
    setError(null);
    setMsg(null);
    const note = window.prompt(approve ? 'Approval note (optional)' : 'Rejection reason', '');
    if (note === null) return;
    try {
      if (approve) await creditHoldsApi.approve(id, note);
      else await creditHoldsApi.reject(id, note);
      setMsg(approve ? 'Credit hold approved — order confirmed.' : 'Credit hold rejected.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Credit Holds</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Bookings blocked because they breach the customer credit limit. Approving confirms the order;
        rejecting leaves it on hold. Requires the <code>credit_hold.approve</code> permission.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

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
              <th style={th}>Order</th>
              <th style={th}>Customer</th>
              <th style={th}>Requested</th>
              <th style={th}>Limit</th>
              <th style={th}>Exposure</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = String(r.status);
              return (
                <tr key={r.id}>
                  <td style={td}>
                    <Link href={`/app/orders/${r.orderId}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                      {String(r.orderNo ?? '')}
                    </Link>
                  </td>
                  <td style={td}>{String(r.customerName ?? '—')}</td>
                  <td style={td}>{money(r.requestedAmount)}</td>
                  <td style={td}>{money(r.creditLimit)}</td>
                  <td style={td}>{money(r.exposureAfter)}</td>
                  <td style={td}><span style={{ color: statusColor[st] ?? 'var(--text)', fontWeight: 600 }}>{st}</span></td>
                  <td style={td}>
                    {st === 'pending' ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button style={button} onClick={() => decide(String(r.id), true)}>Approve</button>
                        <button style={ghostButton} onClick={() => decide(String(r.id), false)}>Reject</button>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{String(r.decisionNote ?? '')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td style={td} colSpan={7}>No credit holds.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
