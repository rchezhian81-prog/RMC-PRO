'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { batchQueueApi, batchTicketsApi, ordersApi, type Row } from '../../../../lib/api';
import { button, card, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');
const badge = (s: string) => ({
  color: ({ waiting: '#e0b341', batching: '#8ab4ff', completed: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)',
  fontWeight: 600,
});

export default function BatchQueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [q, o] = await Promise.all([batchQueueApi.list(), ordersApi.list('confirmed')]);
    setRows(q);
    setOrders(o);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    await run(async () => { await batchQueueApi.enqueueFromOrder(orderId); setOrderId(''); await reload(); }, 'Order sent to batch queue');
  }

  async function startBatch(entry: Row) {
    const remaining = Number(entry.plannedQuantityM3) - Number(entry.producedQuantityM3);
    const qtyStr = window.prompt(`Batch quantity (m³), remaining ${remaining}`, String(remaining));
    if (qtyStr === null) return;
    await run(async () => {
      const ticket = await batchTicketsApi.createFromQueue(String(entry.id), { batchQuantityM3: Number(qtyStr) });
      router.push(`/app/production/batch-tickets/${ticket.id}`);
    });
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Batch Queue</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Loads waiting for batching. Send a confirmed order to the queue, then start a manual batch ticket.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Send confirmed order to queue</h3>
        <form onSubmit={enqueue} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Confirmed order</label>
            <select style={{ ...input, width: 260 }} value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
              <option value="">— select —</option>
              {orders.map((o) => <option key={o.id} value={String(o.id)}>{String(o.orderNo)} · ₹{money(o.estimatedOrderValue)}</option>)}
            </select>
          </div>
          <button style={button}>Send to queue</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Grade</th><th style={th}>Planned m³</th><th style={th}>Produced m³</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = String(r.queueStatus);
              return (
                <tr key={r.id}>
                  <td style={td}>{String(r.gradeLabel ?? '—')}</td>
                  <td style={td}>{money(r.plannedQuantityM3)}</td>
                  <td style={td}>{money(r.producedQuantityM3)}</td>
                  <td style={td}><span style={badge(st)}>{st}</span></td>
                  <td style={td}>{(st === 'waiting' || st === 'batching') && <button style={button} onClick={() => startBatch(r)}>Start batch</button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td style={td} colSpan={5}>Queue is empty.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
