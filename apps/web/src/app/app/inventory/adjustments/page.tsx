'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, stockAdjustApi, stockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const when = (v: unknown) => { try { return new Date(v as string).toLocaleString('en-IN'); } catch { return String(v ?? ''); } };

export default function StockAdjustmentsPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '', direction: 'increase', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [b, h, m, p] = await Promise.all([stockApi.balances(), stockAdjustApi.list(), crud('materials').list(), crud('plants').list()]);
    setBalances(b);
    setHistory(h);
    setMaterials(m);
    setPlants(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  async function adjust(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      const res = await stockAdjustApi.adjust({
        plantId: form.plantId || undefined,
        materialId: form.materialId,
        quantity: Number(form.quantity || 0),
        direction: form.direction,
        reason: form.reason || undefined,
      });
      if (res.pendingApproval) {
        setMsg(
          `Would drive stock negative — raised a negative-stock request (pending approval). Available ${money((res.request as Row).availableQuantity)}, required ${money((res.request as Row).requiredQuantity)}.`,
        );
      } else {
        setMsg(`Adjustment applied. New balance: ${money(res.balanceAfter)}.`);
      }
      setForm({ plantId: '', materialId: '', quantity: '', direction: 'increase', reason: '' });
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Stock Adjustments</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>
        Increase or decrease stock with a reason. A decrease that would drive stock negative needs approval before it posts.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="New adjustment">
          <Form onSubmit={adjust} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140 }}>
              <Field label="Plant">
                <select className="mn-input" value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                  <option value="">—</option>
                  {plants.map((p) => (
                    <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 170 }}>
              <Field label="Material" required>
                <select className="mn-input" value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} required>
                  <option value="">— pick —</option>
                  {materials.map((m) => (
                    <option key={m.id} value={String(m.id)}>{String(m.materialName)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 130 }}>
              <Field label="Direction">
                <select className="mn-input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="increase">increase</option>
                  <option value="decrease">decrease</option>
                </select>
              </Field>
            </div>
            <div style={{ minWidth: 110 }}>
              <Field label="Quantity" required>
                <Input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label="Reason">
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Apply</Button>
            </div>
          </Form>
        </Card>
      </div>

      <Card title="Current balances" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : balances.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Current qty</Th>
                <Th>UOM</Th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id}>
                  <Td>{String(b.materialLabel ?? '')}</Td>
                  <Td numeric style={{ color: Number(b.currentQuantity) < 0 ? 'var(--mn-danger)' : 'var(--mn-text)', fontWeight: 600 }}>
                    {money(b.currentQuantity)}
                  </Td>
                  <Td>{String(b.uom ?? '')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No stock yet" />
        )}
      </Card>

      <div style={{ marginTop: 18 }}>
        <Card
          title="Adjustment history"
          padded={false}
          actions={<ExportButton rows={history} columns={['createdAt', 'materialLabel', 'inQuantity', 'outQuantity', 'balanceAfter', 'remarks']} filename="stock-adjustments" />}
        >
          {!loaded ? (
            <TableSkeleton cols={5} />
          ) : history.length ? (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Material</Th>
                    <Th numeric>Change</Th>
                    <Th numeric>Balance after</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => {
                    const inc = Number(r.inQuantity) > 0;
                    return (
                      <tr key={r.id}>
                        <Td>{when(r.createdAt)}</Td>
                        <Td>{String(r.materialLabel ?? '')}</Td>
                        <Td numeric style={{ color: inc ? 'var(--mn-success)' : 'var(--mn-danger)', fontWeight: 600 }}>
                          {inc ? `+${money(r.inQuantity)}` : `−${money(r.outQuantity)}`}
                        </Td>
                        <Td numeric>{money(r.balanceAfter)}</Td>
                        <Td>{r.remarks ? String(r.remarks) : <span style={{ color: 'var(--mn-muted)' }}>—</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No adjustments yet" description="Applied stock adjustments will appear here, newest first." />
          )}
        </Card>
      </div>
    </div>
  );
}
