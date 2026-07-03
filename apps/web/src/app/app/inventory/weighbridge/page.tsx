'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, openPdf, weighbridgeApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const badge = (s: string) => ({ color: ({ draft: '#8aa0c6', completed: '#8ab4ff', matched: '#6ee7a8', cancelled: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)', fontWeight: 600 });
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function WeighbridgePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', grossWeight: '', tareWeight: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [w, m, s, p] = await Promise.all([weighbridgeApi.list(), crud('materials').list(), crud('suppliers').list(), crud('plants').list()]);
    setRows(w); setMaterials(m); setSuppliers(s); setPlants(p);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await reload(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const net = (Number(form.grossWeight || 0) - Number(form.tareWeight || 0)) || 0;

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await weighbridgeApi.create({
        plantId: form.plantId || undefined, supplierId: form.supplierId || undefined, materialId: form.materialId || undefined,
        vehicleNo: form.vehicleNo || undefined, supplierChallanNo: form.supplierChallanNo || undefined,
        grossWeight: Number(form.grossWeight || 0), tareWeight: Number(form.tareWeight || 0),
      });
      setForm({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', grossWeight: '', tareWeight: '' });
    }, 'Weighbridge entry created');
  }

  async function toInward(r: Row) {
    const rate = window.prompt('Rate per unit (for the inward)', '0');
    if (rate === null) return;
    await run(() => weighbridgeApi.toInward(String(r.id), Number(rate || 0)), 'Converted to material inward (draft)');
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Weighbridge</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Manual weighbridge entry (net = gross − tare). Print the slip and convert to a material inward.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New weighbridge entry</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <Sel label="Plant" v={form.plantId} on={(x) => setForm({ ...form, plantId: x })} opts={plants} ov={(o) => String(o.plantName ?? o.plantCode)} w={120} />
          <Sel label="Supplier" v={form.supplierId} on={(x) => setForm({ ...form, supplierId: x })} opts={suppliers} ov={(o) => String(o.supplierName)} w={140} />
          <Sel label="Material" v={form.materialId} on={(x) => setForm({ ...form, materialId: x })} opts={materials} ov={(o) => String(o.materialName)} w={140} />
          <div><label style={lbl}>Vehicle</label><input style={{ ...input, width: 110 }} value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} /></div>
          <Num label="Gross" v={form.grossWeight} on={(x) => setForm({ ...form, grossWeight: x })} req />
          <Num label="Tare" v={form.tareWeight} on={(x) => setForm({ ...form, tareWeight: x })} req />
          <div><label style={lbl}>Net</label><div style={{ ...input, width: 90, background: '#0b1220' }}>{money(net)}</div></div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Slip No</th><th style={th}>Vehicle</th><th style={th}>Material</th><th style={th}>Gross</th><th style={th}>Tare</th><th style={th}>Net</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.slipNo ?? '')}</td>
                <td style={td}>{String(r.vehicleNo ?? '—')}</td>
                <td style={td}>{String(r.materialLabel ?? '—')}</td>
                <td style={td}>{money(r.grossWeight)}</td>
                <td style={td}>{money(r.tareWeight)}</td>
                <td style={td}>{money(r.netWeight)}</td>
                <td style={td}><span style={badge(String(r.status))}>{String(r.status)}</span></td>
                <td style={td}>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button style={ghostButton} onClick={() => openPdf(`/weighbridge/${r.id}/slip`).catch((e) => setError(String(e)))}>Slip</button>
                    {r.status !== 'matched' && r.status !== 'cancelled' && <button style={button} onClick={() => toInward(r)}>To inward</button>}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={8}>No weighbridge entries yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Sel({ label, v, on, opts, ov, w }: { label: string; v: string; on: (v: string) => void; opts: Row[]; ov: (o: Row) => string; w: number }) {
  return (
    <div><label style={lbl}>{label}</label>
      <select style={{ ...input, width: w }} value={v} onChange={(e) => on(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={String(o.id)}>{ov(o)}</option>)}
      </select>
    </div>
  );
}
function Num({ label, v, on, req }: { label: string; v: string; on: (v: string) => void; req?: boolean }) {
  return (<div><label style={lbl}>{label}</label><input type="number" step="any" style={{ ...input, width: 90 }} value={v} onChange={(e) => on(e.target.value)} required={req} /></div>);
}
