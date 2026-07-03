'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { challansApi, openPdf, type Row } from '../../../../../lib/api';
import { button, card, ghostButton, table, td, th } from '../../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const statusColor: Record<string, string> = { draft: '#8aa0c6', issued: '#e0b341', delivered: '#6ee7a8', cancelled: '#ff8080' };

export default function ChallanDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => { setC(await challansApi.get(id)); }, [id]);
  useEffect(() => { load().catch((e) => setError(String(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await load(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  if (!c) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const history = (c.history as Row[]) ?? [];
  const status = String(c.challanStatus);
  const field = (k: string, v: unknown) => (
    <div><div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{k}</div><div style={{ fontSize: 15 }}>{String(v ?? '—')}</div></div>
  );

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/dispatch/challans')}>← Delivery Challans</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(c.challanNo)} <span style={{ fontSize: 13, color: statusColor[status] ?? 'var(--muted)' }}>{status} · invoice {String(c.invoiceStatus)}</span>
      </h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          {field('Grade', c.gradeLabel)}
          {field('Quantity m³', money(c.quantityM3))}
          {field('Slump', c.slump)}
          {field('Receiver', c.receiverName)}
          {field('Return m³', money(c.returnQuantityM3))}
        </div>
      </section>

      <section style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && <button style={button} onClick={() => run(() => challansApi.issue(id), 'Challan issued')}>Issue</button>}
        {status === 'issued' && (
          <button style={button} onClick={() => run(async () => {
            const receiver = window.prompt('Receiver name', 'Site Engineer');
            if (receiver === null) return;
            const ret = window.prompt('Return quantity (m³)', '0');
            await challansApi.deliver(id, { receiverName: receiver, returnQuantityM3: Number(ret || 0) });
          }, 'Marked delivered')}>Mark delivered</button>
        )}
        <button style={ghostButton} onClick={() => openPdf(`/delivery-challans/${id}/pdf`).catch((e) => setError(String(e)))}>Download PDF</button>
        <button style={ghostButton} onClick={() => run(async () => {
          const m = window.prompt('Recipient mobile (WhatsApp)', '');
          if (m !== null) await challansApi.share(id, m);
        }, 'WhatsApp message logged')}>Share on WhatsApp</button>
        {(status === 'draft' || status === 'issued') && (
          <button style={ghostButton} onClick={() => run(async () => {
            const reason = window.prompt('Cancel reason', '');
            if (reason !== null) await challansApi.cancel(id, reason);
          }, 'Challan cancelled')}>Cancel</button>
        )}
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Status history</h3>
        <table style={table}>
          <thead><tr><th style={th}>When</th><th style={th}>From → To</th><th style={th}>Note</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td style={td}>{String(h.createdAt ?? '').slice(0, 19).replace('T', ' ')}</td>
                <td style={td}>{String(h.oldStatus ?? '—')} → {String(h.newStatus)}</td>
                <td style={td}>{String(h.note ?? '—')}</td>
              </tr>
            ))}
            {!history.length && <tr><td style={td} colSpan={3}>No history.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
