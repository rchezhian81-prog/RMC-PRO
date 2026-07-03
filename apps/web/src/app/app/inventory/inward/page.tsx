'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, materialInwardApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const badge = (s: string) => ({ color: ({ draft: '#8aa0c6', posted: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)', fontWeight: 600 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function MaterialInwardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', quantityReceived: '', quantityAccepted: '', rate: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [i, m, s, p] = await Promise.all([materialInwardApi.list(), crud('materials').list(), crud('suppliers').list(), crud('plants').list()]);
    setRows(i); setMaterials(m); setSuppliers(s); setPlants(p);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await materialInwardApi.create({
        plantId: form.plantId || undefined, supplierId: form.supplierId || undefined, materialId: form.materialId,
        vehicleNo: form.vehicleNo || undefined, supplierChallanNo: form.supplierChallanNo || undefined,
        quantityReceived: Number(form.quantityReceived || 0),
        quantityAccepted: form.quantityAccepted ? Number(form.quantityAccepted) : undefined,
        rate: Number(form.rate || 0),
      });
      setForm({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', quantityReceived: '', quantityAccepted: '', rate: '' });
    }, 'Inward created');
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Material Inward</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Receive material (GRN). Posting adds accepted quantity to stock.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New inward</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <Sel label="Plant" v={form.plantId} on={(x) => setForm({ ...form, plantId: x })} opts={plants} ov={(o) => String(o.plantName ?? o.plantCode)} w={130} />
          <Sel label="Supplier" v={form.supplierId} on={(x) => setForm({ ...form, supplierId: x })} opts={suppliers} ov={(o) => String(o.supplierName)} w={150} />
          <Sel label="Material *" v={form.materialId} on={(x) => setForm({ ...form, materialId: x })} opts={materials} ov={(o) => String(o.materialName)} w={150} req />
          <Num label="Received" v={form.quantityReceived} on={(x) => setForm({ ...form, quantityReceived: x })} req />
          <Num label="Accepted" v={form.quantityAccepted} on={(x) => setForm({ ...form, quantityAccepted: x })} />
          <Num label="Rate" v={form.rate} on={(x) => setForm({ ...form, rate: x })} />
          <div><label style={lbl}>Vehicle</label><input style={{ ...input, width: 120 }} value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} /></div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Inward No</th><th style={th}>Material</th><th style={th}>Received</th><th style={th}>Accepted</th><th style={th}>Amount</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.inwardNo ?? '')}</td>
                <td style={td}>{String(r.materialLabel ?? '')}</td>
                <td style={td}>{money(r.quantityReceived)}</td>
                <td style={td}>{money(r.quantityAccepted)}</td>
                <td style={td}>{money(r.amount)}</td>
                <td style={td}><span style={badge(String(r.status))}>{String(r.status)}</span></td>
                <td style={td}>
                  {r.status === 'draft' && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button style={button} onClick={() => run(() => materialInwardApi.post(String(r.id)), 'Posted to stock')}>Post</button>
                      <button style={ghostButton} onClick={() => run(() => materialInwardApi.cancel(String(r.id)))}>Cancel</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={7}>No inwards yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Sel({ label, v, on, opts, ov, w, req }: { label: string; v: string; on: (v: string) => void; opts: Row[]; ov: (o: Row) => string; w: number; req?: boolean }) {
  return (
    <div><label style={lbl}>{label}</label>
      <select style={{ ...input, width: w }} value={v} onChange={(e) => on(e.target.value)} required={req}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={String(o.id)}>{ov(o)}</option>)}
      </select>
    </div>
  );
}
function Num({ label, v, on, req }: { label: string; v: string; on: (v: string) => void; req?: boolean }) {
  return (<div><label style={lbl}>{label}</label><input type="number" step="any" style={{ ...input, width: 90 }} value={v} onChange={(e) => on(e.target.value)} required={req} /></div>);
}
