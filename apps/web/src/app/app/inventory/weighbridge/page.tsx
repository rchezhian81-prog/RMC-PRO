'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, openPdf, weighbridgeApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

// Module-scope field helpers: declared inside the page they would remount on
// every keystroke and the input would lose focus after one character.
function Sel({ label, v, on, opts, ov }: { label: string; v: string; on: (v: string) => void; opts: Row[]; ov: (o: Row) => string }) {
  return (
    <div style={{ minWidth: 140 }}>
      <Field label={label}>
        <select className="mn-input" value={v} onChange={(e) => on(e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.id} value={String(o.id)}>{ov(o)}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
function Num({ label, v, on, req }: { label: string; v: string; on: (v: string) => void; req?: boolean }) {
  return (
    <div style={{ minWidth: 100 }}>
      <Field label={label} required={req}>
        <Input type="number" step="any" inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} required={req} />
      </Field>
    </div>
  );
}

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
    setRows(w);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  const net = Number(form.grossWeight || 0) - Number(form.tareWeight || 0) || 0;

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await weighbridgeApi.create({
        plantId: form.plantId || undefined,
        supplierId: form.supplierId || undefined,
        materialId: form.materialId || undefined,
        vehicleNo: form.vehicleNo || undefined,
        supplierChallanNo: form.supplierChallanNo || undefined,
        grossWeight: Number(form.grossWeight || 0),
        tareWeight: Number(form.tareWeight || 0),
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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Weighbridge</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Manual weighbridge entry (net = gross − tare). Print the slip and convert to a material inward.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New weighbridge entry">
          <Form onSubmit={create} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <Sel label="Plant" v={form.plantId} on={(x) => setForm({ ...form, plantId: x })} opts={plants} ov={(o) => String(o.plantName ?? o.plantCode)} />
            <Sel label="Supplier" v={form.supplierId} on={(x) => setForm({ ...form, supplierId: x })} opts={suppliers} ov={(o) => String(o.supplierName)} />
            <Sel label="Material" v={form.materialId} on={(x) => setForm({ ...form, materialId: x })} opts={materials} ov={(o) => String(o.materialName)} />
            <div style={{ minWidth: 120 }}>
              <Field label="Vehicle">
                <Input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} />
              </Field>
            </div>
            <Num label="Gross" v={form.grossWeight} on={(x) => setForm({ ...form, grossWeight: x })} req />
            <Num label="Tare" v={form.tareWeight} on={(x) => setForm({ ...form, tareWeight: x })} req />
            <div style={{ minWidth: 90 }}>
              <Field label="Net">
                <div className="mn-input" style={{ background: 'var(--mn-surface-2)', fontWeight: 600 }}>{money(net)}</div>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Weighbridge entries" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Slip No</Th>
                <Th>Vehicle</Th>
                <Th>Material</Th>
                <Th numeric>Gross</Th>
                <Th numeric>Tare</Th>
                <Th numeric>Net</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.slipNo ?? '')}</Td>
                  <Td>{String(r.vehicleNo ?? '—')}</Td>
                  <Td>{String(r.materialLabel ?? '—')}</Td>
                  <Td numeric>{money(r.grossWeight)}</Td>
                  <Td numeric>{money(r.tareWeight)}</Td>
                  <Td numeric>{money(r.netWeight)}</Td>
                  <Td><StatusBadge status={String(r.status)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="secondary" size="sm" onClick={() => openPdf(`/weighbridge/${r.id}/slip`).catch((e) => setError(String(e)))}>Slip</Button>
                      {r.status !== 'matched' && r.status !== 'cancelled' && <Button size="sm" onClick={() => toInward(r)}>To inward</Button>}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No weighbridge entries yet" />
        )}
      </Card>
    </div>
  );
}
