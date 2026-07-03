'use client';

import { useCallback, useEffect, useState } from 'react';
import { negativeStockApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const statusColor: Record<string, string> = { pending: '#e0b341', approved: '#6ee7a8', rejected: '#ff8080' };
const FILTERS = ['pending', '', 'approved', 'rejected'];

export default function NegativeStockPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => { setRows(await negativeStockApi.list(filter || undefined)); }, [filter]);
  useEffect(() => { reload().catch((e) => setError(String(e))); }, [reload]);

  async function decide(id: string, approve: boolean) {
    setError(null); setMsg(null);
    const remarks = window.prompt(approve ? 'Approval remarks (optional)' : 'Rejection remarks', '');
    if (remarks === null) return;
    try {
      if (approve) await negativeStockApi.approve(id, remarks);
      else await negativeStockApi.reject(id, remarks);
      setMsg(approve ? 'Approved — negative stock posted.' : 'Rejected.');
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Negative Stock Approvals</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Adjustments that would drive stock below zero. Approving posts the reduction (stock goes negative). Requires <code>negative_stock.approve</code>.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Status</label>
          <select style={{ ...input, width: 160 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => <option key={f} value={f}>{f === '' ? 'All' : f}</option>)}
          </select>
        </div>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Available</th><th style={th}>Required</th><th style={th}>Negative</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = String(r.approvalStatus);
              return (
                <tr key={r.id}>
                  <td style={td}>{String(r.materialLabel ?? '—')}</td>
                  <td style={td}>{money(r.availableQuantity)}</td>
                  <td style={td}>{money(r.requiredQuantity)}</td>
                  <td style={{ ...td, color: '#ff8080' }}>{money(r.negativeQuantity)}</td>
                  <td style={td}>{String(r.requestReason ?? '—')}</td>
                  <td style={td}><span style={{ color: statusColor[st] ?? 'var(--text)', fontWeight: 600 }}>{st}</span></td>
                  <td style={td}>
                    {st === 'pending' ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button style={button} onClick={() => decide(String(r.id), true)}>Approve</button>
                        <button style={ghostButton} onClick={() => decide(String(r.id), false)}>Reject</button>
                      </span>
                    ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{String(r.approvalRemarks ?? '')}</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td style={td} colSpan={7}>No requests.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
