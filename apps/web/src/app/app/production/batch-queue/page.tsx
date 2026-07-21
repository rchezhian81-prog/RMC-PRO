'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { batchQueueApi, batchTicketsApi, ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');

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
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    await run(async () => {
      await batchQueueApi.enqueueFromOrder(orderId);
      setOrderId('');
      await reload();
    }, 'Order sent to batch queue');
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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Batch Queue</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>
        Loads waiting for batching. Send a confirmed order to the queue, then start a manual batch ticket.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Send confirmed order to queue">
          <form onSubmit={enqueue} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 280 }}>
              <Field label="Confirmed order" required>
                <select className="mn-input" value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
                  <option value="">— select —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {String(o.orderNo)} · ₹{money(o.estimatedOrderValue)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Send to queue</Button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Queue" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                <Th numeric>Planned m³</Th>
                <Th numeric>Produced m³</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = String(r.queueStatus);
                return (
                  <tr key={r.id}>
                    <Td>{String(r.gradeLabel ?? '—')}</Td>
                    <Td numeric>{money(r.plannedQuantityM3)}</Td>
                    <Td numeric>{money(r.producedQuantityM3)}</Td>
                    <Td><StatusBadge status={st} /></Td>
                    <Td style={{ textAlign: 'right' }}>
                      {(st === 'waiting' || st === 'batching') && (
                        <Button size="sm" onClick={() => startBatch(r)}>Start batch</Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Queue is empty" description="Send a confirmed order to the queue to begin batching." />
        )}
      </Card>
    </div>
  );
}
