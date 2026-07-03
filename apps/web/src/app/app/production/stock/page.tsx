'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, stockApi, type Row } from '../../../../lib/api';
import { button, card, input, table, td, th } from '../../../../lib/ui';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function StockPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [b, l, m, p] = await Promise.all([stockApi.balances(), stockApi.ledger(), crud('materials').list(), crud('plants').list()]);
    setBalances(b);
    setLedger(l);
    setMaterials(m);
    setPlants(p);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function setOpening(e: FormEvent) {
    e.preventDefault();
    setError(null); setMsg(null);
    try {
      await stockApi.setOpening({ plantId: form.plantId || undefined, materialId: form.materialId, quantity: Number(form.quantity || 0) });
      setForm({ plantId: '', materialId: '', quantity: '' });
      setMsg('Opening balance set.');
      await reload();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Failed'); }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Stock</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Material balances per plant. Reduced automatically by batch consumption. Opening balance is a
        bootstrap until material inward (a later sprint).
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Set opening balance</h3>
        <form onSubmit={setOpening} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Plant</label>
            <select style={{ ...input, width: 150 }} value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
              <option value="">—</option>
              {plants.map((p) => <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Material</label>
            <select style={{ ...input, width: 170 }} value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} required>
              <option value="">— pick —</option>
              {materials.map((m) => <option key={m.id} value={String(m.id)}>{String(m.materialName)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Quantity</label><input type="number" step="any" style={{ ...input, width: 120 }} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></div>
          <button style={button}>Set opening</button>
        </form>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Balances</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Current qty</th><th style={th}>UOM</th></tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id}>
                <td style={td}>{String(b.materialLabel ?? '')}</td>
                <td style={{ ...td, color: Number(b.currentQuantity) < 0 ? '#ff8080' : 'var(--text)' }}>{fmt(b.currentQuantity)}</td>
                <td style={td}>{String(b.uom ?? '')}</td>
              </tr>
            ))}
            {!balances.length && <tr><td style={td} colSpan={3}>No stock yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Recent ledger</h3>
        <table style={table}>
          <thead><tr><th style={th}>When</th><th style={th}>Material</th><th style={th}>Type</th><th style={th}>In</th><th style={th}>Out</th><th style={th}>Balance</th></tr></thead>
          <tbody>
            {ledger.slice(0, 30).map((l) => (
              <tr key={l.id}>
                <td style={td}>{String(l.createdAt ?? '').slice(0, 19).replace('T', ' ')}</td>
                <td style={td}>{String(l.materialLabel ?? '')}</td>
                <td style={td}>{String(l.transactionType)}</td>
                <td style={td}>{fmt(l.inQuantity)}</td>
                <td style={td}>{fmt(l.outQuantity)}</td>
                <td style={td}>{fmt(l.balanceAfter)}</td>
              </tr>
            ))}
            {!ledger.length && <tr><td style={td} colSpan={6}>No transactions yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
