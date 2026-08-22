'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, ordersApi, productionPlansApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

export default function ProductionPlansPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ plantId: '', planDate: '', shift: 'day' });
  const [item, setItem] = useState({ orderId: '', plannedQuantityM3: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [p, pl, o] = await Promise.all([productionPlansApi.list(), crud('plants').list(), ordersApi.list('confirmed')]);
    setRows(p);
    setPlants(pl);
    setOrders(o);
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

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const created = await productionPlansApi.create({ plantId: form.plantId || undefined, planDate: form.planDate || undefined, shift: form.shift });
      setForm({ plantId: '', planDate: '', shift: 'day' });
      await reload();
      setSel(await productionPlansApi.get(String(created.id)));
    });
  }
  async function open(id: string) {
    setMsg(null);
    setError(null);
    setSel(await productionPlansApi.get(id));
  }
  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    await run(async () => {
      const updated = await productionPlansApi.addItem(String(sel.id), { orderId: item.orderId, plannedQuantityM3: Number(item.plannedQuantityM3 || 0) || undefined });
      setSel(updated);
      setItem({ orderId: '', plannedQuantityM3: '' });
    });
  }
  async function removeItem(itemId: string) {
    if (!sel) return;
    await run(async () => {
      await productionPlansApi.removeItem(String(sel.id), itemId);
      setSel(await productionPlansApi.get(String(sel.id)));
    }, 'Line removed');
  }
  async function setPlanStatus(status: string, okMsg: string) {
    if (!sel) return;
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel plan', message: `Cancel plan ${String(sel.planNo)}? Its lines will no longer be batched.`, confirmLabel: 'Cancel plan' });
      if (!ok) return;
    }
    await run(async () => {
      await productionPlansApi.setStatus(String(sel.id), status);
      setSel(await productionPlansApi.get(String(sel.id)));
      await reload();
    }, okMsg);
  }

  const items = (sel?.items as Row[]) ?? [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Production Plans</h1>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="New plan">
        <Form onSubmit={create} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <Field label="Plant">
              <select className="mn-input" value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                <option value="">—</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label="Date">
              <Input type="date" value={form.planDate} onChange={(e) => setForm({ ...form, planDate: e.target.value })} />
            </Field>
          </div>
          <div style={{ minWidth: 110 }}>
            <Field label="Shift">
              <select className="mn-input" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                <option value="day">day</option>
                <option value="night">night</option>
              </select>
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Create</Button>
          </div>
        </Form>
      </Card>

      <Card title="Plans" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Plan No</Th>
                <Th>Date</Th>
                <Th>Shift</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.planNo ?? '')}</Td>
                  <Td>{String(r.planDate ?? '—')}</Td>
                  <Td>{String(r.shift ?? '—')}</Td>
                  <Td><StatusBadge status={String(r.status ?? '')} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => open(String(r.id))}>Open</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No plans yet" />
        )}
      </Card>

      {sel && (
        <Card title={`${String(sel.planNo)} — items`} actions={<StatusBadge status={String(sel.status)} />}>
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Grade</Th>
                <Th numeric>Planned m³</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <Td>{String(orders.find((o) => o.id === it.orderId)?.orderNo ?? '—')}</Td>
                  <Td>{String(it.gradeLabel ?? '—')}</Td>
                  <Td numeric>{String(it.plannedQuantityM3)}</Td>
                  <Td><StatusBadge status={String(it.status)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    {String(sel.status) === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => removeItem(String(it.id))}>Remove</Button>
                    )}
                  </Td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <Td colSpan={5} style={{ color: 'var(--mn-muted)' }}>No items yet.</Td>
                </tr>
              )}
            </tbody>
          </Table>

          <Form onSubmit={addItem} style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240 }}>
              <Field label="Confirmed order" required>
                <select className="mn-input" value={item.orderId} onChange={(e) => setItem({ ...item, orderId: e.target.value })} required>
                  <option value="">— select —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={String(o.id)}>{String(o.orderNo)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 110 }}>
              <Field label="Planned m³">
                <Input type="number" step="any" value={item.plannedQuantityM3} onChange={(e) => setItem({ ...item, plannedQuantityM3: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit" variant="secondary">Add item</Button>
            </div>
          </Form>

          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              onClick={() =>
                run(async () => {
                  const r = await productionPlansApi.enqueue(String(sel.id));
                  setSel(await productionPlansApi.get(String(sel.id)));
                  setMsg(`${(r as Row).queued} load(s) sent to batch queue`);
                  await reload();
                })
              }
            >
              Enqueue to batch queue
            </Button>
            {String(sel.status) === 'draft' && (
              <>
                <Button variant="secondary" onClick={() => setPlanStatus('confirmed', 'Plan confirmed')}>Confirm plan</Button>
                <Button variant="danger" onClick={() => setPlanStatus('cancelled', 'Plan cancelled')}>Cancel plan</Button>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
