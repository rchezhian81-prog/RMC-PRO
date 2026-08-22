'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { batchQueueApi, batchTicketsApi, mixDesignsApi, ordersApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');

export default function BatchQueuePage() {
  const router = useRouter();
  const { prompt, confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [mixes, setMixes] = useState<Row[]>([]);
  const [mixByRow, setMixByRow] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [q, o, mx] = await Promise.all([batchQueueApi.list(), ordersApi.list('confirmed'), mixDesignsApi.list()]);
    setRows(q);
    setOrders(o);
    setMixes(mx);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
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

  async function setQueueStatus(r: Row, status: string, okMsg: string) {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel load', message: `Cancel the queued load for ${String(r.gradeLabel ?? 'this grade')}?`, confirmLabel: 'Cancel load' });
      if (!ok) return;
    }
    await run(async () => {
      await batchQueueApi.setStatus(String(r.id), status);
      await reload();
    }, okMsg);
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
    const qtyStr = await prompt({ title: 'Start batch', label: `Batch quantity (m³), remaining ${remaining}`, defaultValue: String(remaining), type: 'number', confirmLabel: 'Start' });
    if (qtyStr === null) return;
    // Optional explicit mix design — falls back to the grade's approved mix when
    // left on "Auto". Lets an operator proceed even if the queue line's grade
    // can't auto-resolve a mix.
    const mixDesignId = mixByRow[String(entry.id)] || undefined;
    await run(async () => {
      const ticket = await batchTicketsApi.createFromQueue(String(entry.id), { batchQuantityM3: Number(qtyStr), mixDesignId });
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
          <Form onSubmit={enqueue} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
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
          </Form>
        </Card>
      </div>

      <Card title="Queue" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
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
                      <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {(st === 'waiting' || st === 'batching') && (
                          <>
                            <select
                              className="mn-input"
                              style={{ maxWidth: 190 }}
                              value={mixByRow[String(r.id)] ?? ''}
                              onChange={(e) => setMixByRow({ ...mixByRow, [String(r.id)]: e.target.value })}
                              title="Mix design — defaults to the grade's approved mix"
                            >
                              <option value="">Auto by grade</option>
                              {mixes
                                .filter((mx) => mx.approvalStatus === 'approved')
                                .map((mx) => (
                                  <option key={mx.id} value={String(mx.id)}>{String(mx.mixCode ?? mx.id)}</option>
                                ))}
                            </select>
                            <Button size="sm" onClick={() => startBatch(r)}>Start batch</Button>
                          </>
                        )}
                        {st === 'waiting' && (
                          <Button variant="secondary" size="sm" onClick={() => setQueueStatus(r, 'held', 'Load held')}>Hold</Button>
                        )}
                        {st === 'held' && (
                          <Button variant="secondary" size="sm" onClick={() => setQueueStatus(r, 'waiting', 'Load resumed')}>Resume</Button>
                        )}
                        {(st === 'waiting' || st === 'held') && (
                          <Button variant="danger" size="sm" onClick={() => setQueueStatus(r, 'cancelled', 'Load cancelled')}>Cancel</Button>
                        )}
                      </div>
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
