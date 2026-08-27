'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crud, stockApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function StockPage() {
  const [balances, setBalances] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [form, setForm] = useState({ plantId: '', materialId: '', quantity: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [b, l, m, p] = await Promise.all([
      stockApi.balances(),
      stockApi.ledger(),
      crud('materials').list(),
      crud('plants').list(),
    ]);
    setBalances(b);
    setLedger(l);
    setMaterials(m);
    setPlants(p);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function setOpening(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      await stockApi.setOpening({ plantId: form.plantId || undefined, materialId: form.materialId, quantity: Number(form.quantity || 0) });
      setForm({ plantId: '', materialId: '', quantity: '' });
      setMsg('Opening balance set.');
      await reload();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Stock</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0, maxWidth: 760 }}>
          Material balances per plant. Reduced automatically by batch consumption; opening balance is a bootstrap
          until material inward.
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13, margin: 0 }}>
          {msg}
        </p>
      )}

      <Card title="Set opening balance">
        <Form onSubmit={setOpening} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <Field label="Plant">
              <select className="mn-input" value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                <option value="">—</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>{String(p.plantName ?? p.plantCode)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
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
            <Field label="Quantity" required>
              <Input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Set opening</Button>
          </div>
        </Form>
      </Card>

      <Card
        title="Balances"
        padded={false}
        actions={
          <ExportButton
            rows={balances}
            columns={['materialLabel', 'currentQuantity', 'uom']}
            filename="stock-balances"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton cols={3} />
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
                    {fmt(b.currentQuantity)}
                  </Td>
                  <Td>{String(b.uom ?? '')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No stock yet" description="Set an opening balance to begin." />
        )}
      </Card>

      <Card
        title="Ledger — latest 200 (export for the full set)"
        padded={false}
        actions={
          <ExportButton
            rows={ledger}
            columns={['createdAt', 'materialLabel', 'transactionType', 'inQuantity', 'outQuantity', 'balanceAfter']}
            filename="stock-ledger"
          />
        }
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : ledger.length ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Material</Th>
                <Th>Type</Th>
                <Th numeric>In</Th>
                <Th numeric>Out</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.slice(0, 200).map((l) => (
                <tr key={l.id}>
                  <Td>{String(l.createdAt ?? '').slice(0, 19).replace('T', ' ')}</Td>
                  <Td>{String(l.materialLabel ?? '')}</Td>
                  <Td>{String(l.transactionType)}</Td>
                  <Td numeric>{fmt(l.inQuantity)}</Td>
                  <Td numeric>{fmt(l.outQuantity)}</Td>
                  <Td numeric>{fmt(l.balanceAfter)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No transactions yet" />
        )}
      </Card>
    </div>
  );
}
