'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, stockAdjustApi, stockApi, type Row } from '../../../../lib/api';
import { button, card, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function StockAdjustmentsPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '', direction: 'increase', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [b, m, p] = await Promise.all([stockApi.balances(), crud('materials').list(), crud('plants').list()]);
    setBalances(b); setMaterials(m); setPlants(p);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function adjust(e: FormEvent) {
    e.preventDefault();
    setError(null); setMsg(null);
    try {
      const res = await stockAdjustApi.adjust({
        plantId: form.plantId || undefined, materialId: form.materialId,
        quantity: Number(form.quantity || 0), direction: form.direction, reason: form.reason || undefined,
      });
      if (res.pendingApproval) {
        setMsg(`Would drive stock negative — raised a negative-stock request (pending approval). Available ${money((res.request as Row).availableQuantity)}, required ${money((res.request as Row).requiredQuantity)}.`);
      } else {
        setMsg(`Adjustment applied. New balance: ${money(res.balanceAfter)}.`);
      }
      setForm({ plantId: '', materialId: '', quantity: '', direction: 'increase', reason: '' });
      await reload();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Stock Adjustments</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Increase or decrease stock with a reason. A decrease that would drive stock negative needs approval before it posts.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <form onSubmit={adjust} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Plant</label>
            <select style={{ ...input, width: 130 }} value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
              <option value="">—</option>{plants.map((p) => <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Material *</label>
            <select style={{ ...input, width: 160 }} value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} required>
              <option value="">— pick —</option>{materials.map((m) => <option key={m.id} value={String(m.id)}>{String(m.materialName)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Direction</label>
            <select style={{ ...input, width: 120 }} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="increase">increase</option><option value="decrease">decrease</option>
            </select>
          </div>
          <div><label style={lbl}>Quantity *</label><input type="number" step="any" style={{ ...input, width: 100 }} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></div>
          <div><label style={lbl}>Reason</label><input style={{ ...input, width: 180 }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <button style={button}>Apply</button>
        </form>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Current balances</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Current qty</th><th style={th}>UOM</th></tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id}>
                <td style={td}>{String(b.materialLabel ?? '')}</td>
                <td style={{ ...td, color: Number(b.currentQuantity) < 0 ? '#ff8080' : 'var(--text)' }}>{money(b.currentQuantity)}</td>
                <td style={td}>{String(b.uom ?? '')}</td>
              </tr>
            ))}
            {!balances.length && <tr><td style={td} colSpan={3}>No stock yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
