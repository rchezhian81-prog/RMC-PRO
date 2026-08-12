'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, openPdf, weighbridgeApi, weighbridgeIndicatorApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

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

const emptyForm = { plantId: '', supplierId: '', materialId: '', vehicleNo: '', supplierChallanNo: '', grossWeight: '', tareWeight: '' };
// Provenance tracking for the E1 hardware bridge: which weights came off the
// indicator, and whether the operator hand-edited a device reading afterwards.
const noCapture = { grossFromDevice: false, tareFromDevice: false, overridden: false };

export default function WeighbridgePage() {
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [indicators, setIndicators] = useState<Row[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [indicatorId, setIndicatorId] = useState('');
  const [capture, setCapture] = useState(noCapture);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [w, m, s, p, ind] = await Promise.all([
      weighbridgeApi.list(),
      crud('materials').list(),
      crud('suppliers').list(),
      crud('plants').list(),
      weighbridgeIndicatorApi.list().catch(() => [] as Row[]),
    ]);
    setRows(w);
    setMaterials(m);
    setSuppliers(s);
    setPlants(p);
    setIndicators(ind);
    if (!indicatorId && ind[0]) setIndicatorId(String(ind[0].id));
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

  // ---- E1: live "Get weight" read off the selected indicator ----
  async function getWeight(target: 'gross' | 'tare') {
    setError(null);
    setMsg(null);
    if (!indicatorId) {
      setError('Select a weighbridge indicator first (or add one below)');
      return;
    }
    try {
      const reading = await weighbridgeIndicatorApi.read(indicatorId);
      const kg = String(reading.weightKg);
      if (target === 'gross') {
        setForm((f) => ({ ...f, grossWeight: kg }));
        setCapture((c) => ({ ...c, grossFromDevice: true }));
      } else {
        setForm((f) => ({ ...f, tareWeight: kg }));
        setCapture((c) => ({ ...c, tareFromDevice: true }));
      }
      setMsg(`${reading.indicatorName}: ${money(reading.weightKg)} kg${reading.stable ? '' : ' (unstable)'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Indicator read failed');
    }
  }

  // A hand-edit of a device-captured field is a manual override (retained flag).
  function onWeightChange(target: 'gross' | 'tare', x: string) {
    if (target === 'gross') {
      setForm((f) => ({ ...f, grossWeight: x }));
      setCapture((c) => (c.grossFromDevice ? { ...c, overridden: true } : c));
    } else {
      setForm((f) => ({ ...f, tareWeight: x }));
      setCapture((c) => (c.tareFromDevice ? { ...c, overridden: true } : c));
    }
  }

  const net = Number(form.grossWeight || 0) - Number(form.tareWeight || 0) || 0;
  const usedDevice = capture.grossFromDevice || capture.tareFromDevice;

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
        weightSource: usedDevice ? 'device' : 'manual',
        indicatorId: usedDevice ? indicatorId : undefined,
        manualOverride: usedDevice && capture.overridden,
      });
      setForm(emptyForm);
      setCapture(noCapture);
    }, 'Weighbridge entry created');
  }

  async function toInward(r: Row) {
    const rate = await prompt({ title: 'Convert to inward', label: 'Rate per unit (for the inward)', defaultValue: '0', type: 'number' });
    if (rate === null) return;
    await run(() => weighbridgeApi.toInward(String(r.id), Number(rate || 0)), 'Converted to material inward (draft)');
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Weighbridge</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>
        Capture the weight off the indicator with <strong>Get weight</strong>, or key it in by hand (net = gross − tare). Print the slip and convert to a material inward.
      </p>
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
            <Sel label="Indicator" v={indicatorId} on={setIndicatorId} opts={indicators} ov={(o) => String(o.name)} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
              <Num label="Gross" v={form.grossWeight} on={(x) => onWeightChange('gross', x)} req />
              <div style={{ marginBottom: 14 }}>
                <Button type="button" variant="secondary" size="sm" onClick={() => getWeight('gross')}>⚖ Get</Button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
              <Num label="Tare" v={form.tareWeight} on={(x) => onWeightChange('tare', x)} req />
              <div style={{ marginBottom: 14 }}>
                <Button type="button" variant="secondary" size="sm" onClick={() => getWeight('tare')}>⚖ Get</Button>
              </div>
            </div>
            <div style={{ minWidth: 90 }}>
              <Field label="Net">
                <div className="mn-input" style={{ background: 'var(--mn-surface-2)', fontWeight: 600 }}>{money(net)}</div>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </Form>
          {usedDevice && (
            <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: '8px 2px 0' }}>
              Weights captured from the indicator{capture.overridden ? ' (manually adjusted — saved as an override)' : ''}.
            </p>
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 18 }}>
        <IndicatorCard indicators={indicators} plants={plants} onDone={(m) => run(() => Promise.resolve(), m)} onError={setError} />
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
                <Th>Source</Th>
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
                  <Td>{r.weightSource === 'device' ? (r.manualOverride ? 'Device*' : 'Device') : 'Manual'}</Td>
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

// ---- Indicator device management (E1) ----
function IndicatorCard({
  indicators,
  plants,
  onDone,
  onError,
}: {
  indicators: Row[];
  plants: Row[];
  onDone: (msg: string) => void;
  onError: (e: string) => void;
}) {
  const [dev, setDev] = useState({ name: '', plantId: '', connectionType: 'simulated', simulatedWeightKg: '25000', host: '', port: '', comPort: '', baudRate: '9600' });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = {
        name: dev.name,
        plantId: dev.plantId || undefined,
        connectionType: dev.connectionType,
      };
      if (dev.connectionType === 'simulated') body.simulatedWeightKg = Number(dev.simulatedWeightKg || 0);
      if (dev.connectionType === 'tcp') { body.host = dev.host; body.port = Number(dev.port || 0); }
      if (dev.connectionType === 'serial') { body.comPort = dev.comPort; body.baudRate = Number(dev.baudRate || 0); }
      await weighbridgeIndicatorApi.create(body);
      setDev({ name: '', plantId: '', connectionType: 'simulated', simulatedWeightKg: '25000', host: '', port: '', comPort: '', baudRate: '9600' });
      onDone('Indicator device added');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add indicator');
    }
  }

  return (
    <Card title="Weighbridge indicators">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: '0 0 12px' }}>
        The scale head the plant reads from. A <strong>simulated</strong> device returns a stable demo weight; a <strong>TCP</strong> device is read over the network; a <strong>serial/COM</strong> device is read by the plant-side app.
      </p>
      <Form onSubmit={add} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 150 }}>
          <Field label="Name" required>
            <Input value={dev.name} onChange={(e) => setDev({ ...dev, name: e.target.value })} required />
          </Field>
        </div>
        <Sel label="Plant" v={dev.plantId} on={(x) => setDev({ ...dev, plantId: x })} opts={plants} ov={(o) => String(o.plantName ?? o.plantCode)} />
        <div style={{ minWidth: 130 }}>
          <Field label="Connection">
            <select className="mn-input" value={dev.connectionType} onChange={(e) => setDev({ ...dev, connectionType: e.target.value })}>
              <option value="simulated">Simulated</option>
              <option value="tcp">TCP</option>
              <option value="serial">Serial / COM</option>
            </select>
          </Field>
        </div>
        {dev.connectionType === 'simulated' && (
          <div style={{ minWidth: 130 }}>
            <Field label="Demo weight (kg)">
              <Input type="number" step="any" value={dev.simulatedWeightKg} onChange={(e) => setDev({ ...dev, simulatedWeightKg: e.target.value })} />
            </Field>
          </div>
        )}
        {dev.connectionType === 'tcp' && (
          <>
            <div style={{ minWidth: 130 }}>
              <Field label="Host"><Input value={dev.host} onChange={(e) => setDev({ ...dev, host: e.target.value })} /></Field>
            </div>
            <div style={{ minWidth: 90 }}>
              <Field label="Port"><Input type="number" value={dev.port} onChange={(e) => setDev({ ...dev, port: e.target.value })} /></Field>
            </div>
          </>
        )}
        {dev.connectionType === 'serial' && (
          <>
            <div style={{ minWidth: 120 }}>
              <Field label="COM port"><Input value={dev.comPort} onChange={(e) => setDev({ ...dev, comPort: e.target.value })} /></Field>
            </div>
            <div style={{ minWidth: 90 }}>
              <Field label="Baud"><Input type="number" value={dev.baudRate} onChange={(e) => setDev({ ...dev, baudRate: e.target.value })} /></Field>
            </div>
          </>
        )}
        <div style={{ marginBottom: 14 }}>
          <Button type="submit">Add</Button>
        </div>
      </Form>
      {indicators.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {indicators.map((d) => (
            <span key={d.id} style={{ fontSize: 12, border: '1px solid var(--mn-border)', borderRadius: 'var(--mn-radius-md)', padding: '4px 10px' }}>
              <strong>{String(d.name)}</strong> · {String(d.connectionType)}{d.isActive === false ? ' · inactive' : ''}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
