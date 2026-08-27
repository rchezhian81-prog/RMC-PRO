'use client';

import { useEffect, useState } from 'react';
import { inventoryReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function InventoryReportsPage() {
  const [low, setLow] = useState<Row[]>([]);
  const [negative, setNegative] = useState<Row[]>([]);
  const [valuation, setValuation] = useState<{ rows: Row[]; total: number } | null>(null);
  const [movement, setMovement] = useState<Row[]>([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [l, n, v, mv] = await Promise.all([
      inventoryReportsApi.lowStock(),
      inventoryReportsApi.negativeStock(),
      inventoryReportsApi.valuation(),
      inventoryReportsApi.movement(from || undefined, to || undefined),
    ]);
    setLow(l);
    setNegative(n);
    setValuation(v);
    setMovement(mv);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Inventory Reports</h1>
      {error && <ErrorState message={error} />}

      <Card title="Period (movement)">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bounds the movement report; stock levels &amp; valuation are current-state.</span>
        </div>
      </Card>

      <Card title="Negative stock" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={3} />
        ) : negative.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Current qty</Th>
                <Th>UOM</Th>
              </tr>
            </thead>
            <tbody>
              {negative.map((r) => (
                <tr key={r.id}>
                  <Td>{String(r.materialLabel ?? '')}</Td>
                  <Td numeric style={{ color: 'var(--mn-danger)', fontWeight: 600 }}>{money(r.currentQuantity)}</Td>
                  <Td>{String(r.uom ?? '')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No negative balances" />
        )}
      </Card>

      <Card title="Low stock (at / below reorder level)" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={3} />
        ) : low.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Current qty</Th>
                <Th numeric>Reorder level</Th>
                <Th>UOM</Th>
              </tr>
            </thead>
            <tbody>
              {low.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.material)}</Td>
                  <Td numeric style={{ color: 'var(--mn-warning)', fontWeight: 600 }}>{money(r.currentQuantity)}</Td>
                  <Td numeric>{money(r.reorderLevel)}</Td>
                  <Td>{String(r.uom ?? '')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No low-stock materials" />
        )}
      </Card>

      <Card title={`Stock valuation${valuation ? ` — total ₹${money(valuation.total)}` : ''}`} padded={false} actions={<ExportButton rows={valuation?.rows ?? []} columns={['material', 'currentQuantity', 'standardRate', 'value']} filename="stock-valuation" />}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : valuation?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Qty</Th>
                <Th numeric>Rate</Th>
                <Th numeric>Value</Th>
              </tr>
            </thead>
            <tbody>
              {valuation.rows.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.material)}</Td>
                  <Td numeric>{money(r.currentQuantity)}</Td>
                  <Td numeric>{money(r.standardRate)}</Td>
                  <Td numeric style={{ fontWeight: 600 }}>{money(r.value)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No stock" />
        )}
      </Card>

      <Card title="Movement (total in / out)" padded={false} actions={<ExportButton rows={movement} columns={['material', 'totalIn', 'totalOut']} filename="stock-movement" />}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : movement.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Total in</Th>
                <Th numeric>Total out</Th>
              </tr>
            </thead>
            <tbody>
              {movement.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.material)}</Td>
                  <Td numeric>{money(r.totalIn)}</Td>
                  <Td numeric>{money(r.totalOut)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No movement yet" />
        )}
      </Card>
    </div>
  );
}
