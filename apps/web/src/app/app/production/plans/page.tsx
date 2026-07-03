'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, ordersApi, productionPlansApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function ProductionPlansPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ plantId: '', planDate: '', shift: 'day' });
  const [item, setItem] = useState({ orderId: '', plannedQuantityM3: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [p, pl, o] = await Promise.all([productionPlansApi.list(), crud('plants').list(), ordersApi.list('confirmed')]);
    setRows(p);
    setPlants(pl);
    setOrders(o);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
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
  async function open(id: string) { setMsg(null); setError(null); setSel(await productionPlansApi.get(id)); }
  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    await run(async () => {
      const updated = await productionPlansApi.addItem(String(sel.id), { orderId: item.orderId, plannedQuantityM3: Number(item.plannedQuantityM3 || 0) || undefined });
      setSel(updated);
      setItem({ orderId: '', plannedQuantityM3: '' });
    });
  }

  const items = (sel?.items as Row[]) ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Production Plans</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Plan</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Plant</label>
            <select style={{ ...input, width: 160 }} value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
              <option value="">—</option>
              {plants.map((p) => <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Date</label><input type="date" style={input} value={form.planDate} onChange={(e) => setForm({ ...form, planDate: e.target.value })} /></div>
          <div><label style={lbl}>Shift</label>
            <select style={{ ...input, width: 100 }} value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              <option value="day">day</option><option value="night">night</option>
            </select>
          </div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Plan No</th><th style={th}>Date</th><th style={th}>Shift</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.planNo ?? '')}</td>
                <td style={td}>{String(r.planDate ?? '—')}</td>
                <td style={td}>{String(r.shift ?? '—')}</td>
                <td style={td}>{String(r.status ?? '')}</td>
                <td style={td}><button style={ghostButton} onClick={() => open(String(r.id))}>Open</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={5}>No plans yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {sel && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>{String(sel.planNo)} — items <span style={{ color: 'var(--muted)', fontSize: 12 }}>({String(sel.status)})</span></h3>
          <table style={table}>
            <thead><tr><th style={th}>Order</th><th style={th}>Grade</th><th style={th}>Planned m³</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={td}>{String(orders.find((o) => o.id === it.orderId)?.orderNo ?? '—')}</td>
                  <td style={td}>{String(it.gradeLabel ?? '—')}</td>
                  <td style={td}>{String(it.plannedQuantityM3)}</td>
                  <td style={td}>{String(it.status)}</td>
                </tr>
              ))}
              {!items.length && <tr><td style={td} colSpan={4}>No items yet.</td></tr>}
            </tbody>
          </table>

          <form onSubmit={addItem} style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 12, flexWrap: 'wrap' }}>
            <div><label style={lbl}>Confirmed order</label>
              <select style={{ ...input, width: 240 }} value={item.orderId} onChange={(e) => setItem({ ...item, orderId: e.target.value })} required>
                <option value="">— select —</option>
                {orders.map((o) => <option key={o.id} value={String(o.id)}>{String(o.orderNo)}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Planned m³</label><input type="number" step="any" style={{ ...input, width: 100 }} value={item.plannedQuantityM3} onChange={(e) => setItem({ ...item, plannedQuantityM3: e.target.value })} /></div>
            <button style={button}>Add item</button>
          </form>

          <div style={{ marginTop: 14 }}>
            <button style={button} onClick={() => run(async () => { const r = await productionPlansApi.enqueue(String(sel.id)); setSel(await productionPlansApi.get(String(sel.id))); setMsg(`${(r as Row).queued} load(s) sent to batch queue`); await reload(); })}>
              Enqueue to batch queue
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
