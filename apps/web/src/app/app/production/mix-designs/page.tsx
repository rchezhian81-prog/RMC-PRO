'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, mixDesignsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

export default function MixDesignsPage() {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ mixCode: '', gradeId: '', slumpMin: '', slumpMax: '', cementType: '' });
  const [mat, setMat] = useState({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [m, g, mt] = await Promise.all([mixDesignsApi.list(), crud('concrete-grades').list(), crud('materials').list()]);
    setRows(m);
    setGrades(g);
    setMaterials(mt);
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
      const g = grades.find((x) => String(x.id) === form.gradeId);
      const created = await mixDesignsApi.create({
        mixCode: form.mixCode,
        gradeId: form.gradeId || undefined,
        slumpMin: form.slumpMin || undefined,
        slumpMax: form.slumpMax || undefined,
        cementType: form.cementType || undefined,
        gradeLabel: g ? String(g.gradeCode) : undefined,
      });
      setForm({ mixCode: '', gradeId: '', slumpMin: '', slumpMax: '', cementType: '' });
      await reload();
      setSel(await mixDesignsApi.get(String(created.id)));
    });
  }
  async function open(id: string) {
    setMsg(null);
    setError(null);
    setSel(await mixDesignsApi.get(id));
  }
  async function addMaterial(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    const m = materials.find((x) => String(x.id) === mat.materialId);
    await run(async () => {
      const updated = await mixDesignsApi.addMaterial(String(sel.id), {
        materialId: mat.materialId || undefined,
        materialLabel: m ? String(m.materialName) : undefined,
        targetQuantity: Number(mat.targetQuantity || 0),
        uom: m ? String(m.uom ?? 'kg') : 'kg',
        tolerancePercentage: Number(mat.tolerancePercentage || 2),
      });
      setSel(updated);
      setMat({ materialId: '', targetQuantity: '', tolerancePercentage: '2' });
    });
  }

  const mats = (sel?.materials as Row[]) ?? [];
  const locked = sel?.approvalStatus === 'approved';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Mix Designs</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0, maxWidth: 760 }}>
          Recipe of material targets per m³. Batching may only use an <b>approved</b> mix design.
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="New mix design">
        <Form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ minWidth: 150 }}>
            <Field label="Mix code" required>
              <Input value={form.mixCode} onChange={(e) => setForm({ ...form, mixCode: e.target.value })} required />
            </Field>
          </div>
          <div style={{ minWidth: 120 }}>
            <Field label="Grade">
              <select className="mn-input" value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })}>
                <option value="">—</option>
                {grades.map((g) => (
                  <option key={g.id} value={String(g.id)}>{String(g.gradeCode)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ minWidth: 90 }}>
            <Field label="Slump min">
              <Input type="number" value={form.slumpMin} onChange={(e) => setForm({ ...form, slumpMin: e.target.value })} />
            </Field>
          </div>
          <div style={{ minWidth: 90 }}>
            <Field label="Slump max">
              <Input type="number" value={form.slumpMax} onChange={(e) => setForm({ ...form, slumpMax: e.target.value })} />
            </Field>
          </div>
          <div style={{ minWidth: 120 }}>
            <Field label="Cement type">
              <Input value={form.cementType} onChange={(e) => setForm({ ...form, cementType: e.target.value })} />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Create</Button>
          </div>
        </Form>
      </Card>

      <Card title="Mix designs" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Mix code</Th>
                <Th numeric>Ver</Th>
                <Th>Grade</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.mixCode ?? '')}</Td>
                  <Td numeric>{String(r.versionNo ?? 1)}</Td>
                  <Td>{String(r.gradeId ? (grades.find((g) => g.id === r.gradeId)?.gradeCode ?? '—') : '—')}</Td>
                  <Td><StatusBadge status={String(r.approvalStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => open(String(r.id))}>Open</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No mix designs yet" />
        )}
      </Card>

      {sel && (
        <Card title={`${String(sel.mixCode)} — materials`} actions={<StatusBadge status={String(sel.approvalStatus)} />}>
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Target /m³</Th>
                <Th>UOM</Th>
                <Th numeric>Tol %</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {mats.map((mm) => (
                <tr key={mm.id}>
                  <Td>{String(mm.materialLabel ?? '')}</Td>
                  <Td numeric>{String(mm.targetQuantity)}</Td>
                  <Td>{String(mm.uom ?? '')}</Td>
                  <Td numeric>{String(mm.tolerancePercentage)}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    {!locked && (
                      <Button variant="ghost" size="sm" onClick={() => run(async () => { if (!(await confirm({ title: 'Remove material', message: `Remove ${String(mm.materialLabel ?? 'this material')} from the mix? It changes what can be batched.`, confirmLabel: 'Remove', danger: true }))) return; setSel(await mixDesignsApi.deleteMaterial(String(sel.id), String(mm.id))); })}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              {!mats.length && (
                <tr>
                  <Td colSpan={5} style={{ color: 'var(--mn-muted)' }}>No materials yet.</Td>
                </tr>
              )}
            </tbody>
          </Table>

          {!locked && (
            <Form onSubmit={addMaterial} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 14 }}>
              <div style={{ minWidth: 160 }}>
                <Field label="Material" required>
                  <select className="mn-input" value={mat.materialId} onChange={(e) => setMat({ ...mat, materialId: e.target.value })} required>
                    <option value="">— pick —</option>
                    {materials.map((m) => (
                      <option key={m.id} value={String(m.id)}>{String(m.materialName)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ minWidth: 110 }}>
                <Field label="Target /m³" required>
                  <Input type="number" step="any" value={mat.targetQuantity} onChange={(e) => setMat({ ...mat, targetQuantity: e.target.value })} required />
                </Field>
              </div>
              <div style={{ minWidth: 100 }}>
                <Field label="Tolerance %">
                  <Input type="number" step="any" value={mat.tolerancePercentage} onChange={(e) => setMat({ ...mat, tolerancePercentage: e.target.value })} />
                </Field>
              </div>
              <div style={{ marginBottom: 14 }}>
                <Button type="submit" variant="secondary">Add material</Button>
              </div>
            </Form>
          )}

          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            {sel.approvalStatus !== 'approved' && (
              <Button onClick={() => run(async () => { setSel(await mixDesignsApi.approve(String(sel.id))); await reload(); }, 'Mix design approved')}>Approve</Button>
            )}
            {sel.approvalStatus === 'draft' && (
              <Button variant="secondary" onClick={() => run(async () => { if (!(await confirm({ title: 'Reject mix design', message: 'Reject this mix design? It will not be usable for batching.', confirmLabel: 'Reject', danger: true }))) return; setSel(await mixDesignsApi.reject(String(sel.id))); await reload(); }, 'Mix design rejected')}>Reject</Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
