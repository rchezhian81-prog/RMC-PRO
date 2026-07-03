'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, mixDesignsApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const badge = (s: string) => ({
  color: ({ draft: '#8aa0c6', approved: '#6ee7a8', rejected: '#ff8080' } as Record<string, string>)[s] ?? 'var(--text)',
  fontWeight: 600,
});
const lbl = { fontSize: 12, color: 'var(--muted)' } as const;

export default function MixDesignsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ mixCode: '', gradeId: '', slumpMin: '', slumpMax: '', cementType: '' });
  const [mat, setMat] = useState({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [m, g, mt] = await Promise.all([mixDesignsApi.list(), crud('concrete-grades').list(), crud('materials').list()]);
    setRows(m);
    setGrades(g);
    setMaterials(mt);
  }
  useEffect(() => { reload().catch((e) => setError(String(e))); }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const g = grades.find((x) => String(x.id) === form.gradeId);
      const created = await mixDesignsApi.create({
        mixCode: form.mixCode, gradeId: form.gradeId || undefined,
        slumpMin: form.slumpMin || undefined, slumpMax: form.slumpMax || undefined, cementType: form.cementType || undefined,
        gradeLabel: g ? String(g.gradeCode) : undefined,
      });
      setForm({ mixCode: '', gradeId: '', slumpMin: '', slumpMax: '', cementType: '' });
      await reload();
      setSel(await mixDesignsApi.get(String(created.id)));
    });
  }
  async function open(id: string) { setMsg(null); setError(null); setSel(await mixDesignsApi.get(id)); }
  async function addMaterial(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    const m = materials.find((x) => String(x.id) === mat.materialId);
    await run(async () => {
      const updated = await mixDesignsApi.addMaterial(String(sel.id), {
        materialId: mat.materialId || undefined, materialLabel: m ? String(m.materialName) : undefined,
        targetQuantity: Number(mat.targetQuantity || 0), uom: m ? String(m.uom ?? 'kg') : 'kg',
        tolerancePercentage: Number(mat.tolerancePercentage || 2),
      });
      setSel(updated);
      setMat({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
    });
  }

  const mats = (sel?.materials as Row[]) ?? [];
  const locked = sel?.approvalStatus === 'approved';

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Mix Designs</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Recipe of material targets per m³. Batching may only use an <b>approved</b> mix design.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Mix Design</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div><label style={lbl}>Mix code *</label><input style={{ ...input, width: 150 }} value={form.mixCode} onChange={(e) => setForm({ ...form, mixCode: e.target.value })} required /></div>
          <div><label style={lbl}>Grade</label>
            <select style={{ ...input, width: 120 }} value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })}>
              <option value="">—</option>
              {grades.map((g) => <option key={g.id} value={String(g.id)}>{String(g.gradeCode)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Slump min</label><input type="number" style={{ ...input, width: 90 }} value={form.slumpMin} onChange={(e) => setForm({ ...form, slumpMin: e.target.value })} /></div>
          <div><label style={lbl}>Slump max</label><input type="number" style={{ ...input, width: 90 }} value={form.slumpMax} onChange={(e) => setForm({ ...form, slumpMax: e.target.value })} /></div>
          <div><label style={lbl}>Cement type</label><input style={{ ...input, width: 110 }} value={form.cementType} onChange={(e) => setForm({ ...form, cementType: e.target.value })} /></div>
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead><tr><th style={th}>Mix code</th><th style={th}>Ver</th><th style={th}>Grade</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.mixCode ?? '')}</td>
                <td style={td}>{String(r.versionNo ?? 1)}</td>
                <td style={td}>{String(r.gradeId ? (grades.find((g) => g.id === r.gradeId)?.gradeCode ?? '—') : '—')}</td>
                <td style={td}><span style={badge(String(r.approvalStatus))}>{String(r.approvalStatus)}</span></td>
                <td style={td}><button style={ghostButton} onClick={() => open(String(r.id))}>Open</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={5}>No mix designs yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {sel && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>
            {String(sel.mixCode)} <span style={badge(String(sel.approvalStatus))}>({String(sel.approvalStatus)})</span>
          </h3>
          <table style={table}>
            <thead><tr><th style={th}>Material</th><th style={th}>Target /m³</th><th style={th}>UOM</th><th style={th}>Tol %</th><th style={th}></th></tr></thead>
            <tbody>
              {mats.map((mm) => (
                <tr key={mm.id}>
                  <td style={td}>{String(mm.materialLabel ?? '')}</td>
                  <td style={td}>{String(mm.targetQuantity)}</td>
                  <td style={td}>{String(mm.uom ?? '')}</td>
                  <td style={td}>{String(mm.tolerancePercentage)}</td>
                  <td style={td}>{!locked && <button style={ghostButton} onClick={() => run(async () => setSel(await mixDesignsApi.deleteMaterial(String(sel.id), String(mm.id))))}>Remove</button>}</td>
                </tr>
              ))}
              {!mats.length && <tr><td style={td} colSpan={5}>No materials yet.</td></tr>}
            </tbody>
          </table>

          {!locked && (
            <form onSubmit={addMaterial} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 12 }}>
              <div><label style={lbl}>Material</label>
                <select style={{ ...input, width: 160 }} value={mat.materialId} onChange={(e) => setMat({ ...mat, materialId: e.target.value })} required>
                  <option value="">— pick —</option>
                  {materials.map((m) => <option key={m.id} value={String(m.id)}>{String(m.materialName)}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Target /m³</label><input type="number" step="any" style={{ ...input, width: 100 }} value={mat.targetQuantity} onChange={(e) => setMat({ ...mat, targetQuantity: e.target.value })} required /></div>
              <div><label style={lbl}>Tolerance %</label><input type="number" step="any" style={{ ...input, width: 90 }} value={mat.tolerancePercentage} onChange={(e) => setMat({ ...mat, tolerancePercentage: e.target.value })} /></div>
              <button style={button}>Add material</button>
            </form>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            {sel.approvalStatus !== 'approved' && (
              <button style={button} onClick={() => run(async () => { setSel(await mixDesignsApi.approve(String(sel.id))); await reload(); }, 'Mix design approved')}>Approve</button>
            )}
            {sel.approvalStatus === 'draft' && (
              <button style={ghostButton} onClick={() => run(async () => { setSel(await mixDesignsApi.reject(String(sel.id))); await reload(); }, 'Mix design rejected')}>Reject</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
