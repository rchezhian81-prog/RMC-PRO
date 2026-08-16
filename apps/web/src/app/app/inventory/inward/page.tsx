'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, materialInwardApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

// These field helpers live at module scope on purpose. Declared inside the page
// they would be a new component type on every keystroke, so React would remount
// the input and it would lose focus after a single character.
function Sel({ label, v, on, opts, ov, req }: { label: string; v: string; on: (v: string) => void; opts: Row[]; ov: (o: Row) => string; req?: boolean }) {
  return (
    <div style={{ minWidth: 150 }}>
      <Field label={label} required={req}>
        <select className="mn-input" value={v} onChange={(e) => on(e.target.value)} required={req}>
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
    <div style={{ minWidth: 110 }}>
      <Field label={label} required={req}>
        <Input type="number" step="any" inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} required={req} />
      </Field>
    </div>
  );
}

export default function MaterialInwardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', quantityReceived: '', quantityAccepted: '', rate: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [i, m, s, p] = await Promise.all([materialInwardApi.list(), crud('materials').list(), crud('suppliers').list(), crud('plants').list()]);
    setRows(i);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
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

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await materialInwardApi.create({
        plantId: form.plantId || undefined,
        supplierId: form.supplierId || undefined,
        materialId: form.materialId,
        vehicleNo: form.vehicleNo || undefined,
        supplierChallanNo: form.supplierChallanNo || undefined,
        quantityReceived: Number(form.quantityReceived || 0),
        quantityAccepted: form.quantityAccepted ? Number(form.quantityAccepted) : undefined,
        rate: Number(form.rate || 0),
      });
      setForm({ plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', quantityReceived: '', quantityAccepted: '', rate: '' });
    }, 'Inward created');
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Material Inward</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Receive material (GRN). Posting adds accepted quantity to stock.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New inward">
          <Form onSubmit={create} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <Sel label="Plant" v={form.plantId} on={(x) => setForm({ ...form, plantId: x })} opts={plants} ov={(o) => String(o.plantName ?? o.plantCode)} />
            <Sel label="Supplier" v={form.supplierId} on={(x) => setForm({ ...form, supplierId: x })} opts={suppliers} ov={(o) => String(o.supplierName)} />
            <Sel label="Material" v={form.materialId} on={(x) => setForm({ ...form, materialId: x })} opts={materials} ov={(o) => String(o.materialName)} req />
            <Num label="Received" v={form.quantityReceived} on={(x) => setForm({ ...form, quantityReceived: x })} req />
            <Num label="Accepted" v={form.quantityAccepted} on={(x) => setForm({ ...form, quantityAccepted: x })} />
            <Num label="Rate" v={form.rate} on={(x) => setForm({ ...form, rate: x })} />
            <div style={{ minWidth: 130 }}>
              <Field label="Vehicle">
                <Input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Inwards" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Inward No</Th>
                <Th>Material</Th>
                <Th numeric>Received</Th>
                <Th numeric>Accepted</Th>
                <Th numeric>Amount</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.inwardNo ?? '')}</Td>
                  <Td>{String(r.materialLabel ?? '')}</Td>
                  <Td numeric>{money(r.quantityReceived)}</Td>
                  <Td numeric>{money(r.quantityAccepted)}</Td>
                  <Td numeric>₹{money(r.amount)}</Td>
                  <Td><StatusBadge status={String(r.status)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    {r.status === 'draft' && (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <Button size="sm" onClick={() => run(() => materialInwardApi.post(String(r.id)), 'Posted to stock')}>Post</Button>
                        <Button variant="secondary" size="sm" onClick={() => run(() => materialInwardApi.cancel(String(r.id)))}>Cancel</Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No inwards yet" description="Receive material to create a GRN." />
        )}
      </Card>
    </div>
  );
}
