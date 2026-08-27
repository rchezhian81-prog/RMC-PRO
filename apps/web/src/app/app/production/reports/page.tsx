'use client';

import { useEffect, useState } from 'react';
import { productionReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function ProductionReportsPage() {
  const [byGrade, setByGrade] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [variance, setVariance] = useState<Row[]>([]);
  const [consumption, setConsumption] = useState<Row[]>([]);
  const [batch, setBatch] = useState<{ rows: Row[]; totalM3: number; count: number } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [s, v, c, b] = await Promise.all([
      productionReportsApi.summary(from || undefined, to || undefined),
      productionReportsApi.variance(),
      productionReportsApi.consumption(from || undefined, to || undefined),
      productionReportsApi.batchRegister(from || undefined, to || undefined),
    ]);
    setByGrade(s.byGrade as Row[]);
    setTotals(s.totals as Row);
    setVariance(v);
    setConsumption(c);
    setBatch(b);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Production Reports</h1>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Filters production summary and material consumption. Leave blank for all-time.</span>
        </div>
      </Card>

      <Card
        title={`Production summary${totals ? ` — ${fmt(totals.batches)} batches · ${fmt(totals.producedM3)} m³` : ''}`}
        padded={false}
        actions={<ExportButton rows={byGrade} columns={['grade', 'batches', 'producedM3', 'varianceBatches']} filename="production-summary" />}
      >
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : byGrade.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                <Th numeric>Batches</Th>
                <Th numeric>Produced m³</Th>
                <Th numeric>Variance batches</Th>
              </tr>
            </thead>
            <tbody>
              {byGrade.map((g, i) => (
                <tr key={i}>
                  <Td>{String(g.grade)}</Td>
                  <Td numeric>{fmt(g.batches)}</Td>
                  <Td numeric>{fmt(g.producedM3)}</Td>
                  <Td numeric>{fmt(g.varianceBatches)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No production yet" />
        )}
      </Card>

      <Card
        title={`Batch register${batch ? ` — ${batch.count} batches · ${fmt(batch.totalM3)} m³` : ''}`}
        padded={false}
        actions={<ExportButton rows={batch?.rows ?? []} columns={['date', 'batchTicketNo', 'gradeLabel', 'm3']} filename="batch-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : batch?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Ticket</Th>
                <Th>Grade</Th>
                <Th numeric>m³</Th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.date ?? '')}</Td>
                  <Td style={{ fontWeight: 600 }}>{String(r.batchTicketNo)}</Td>
                  <Td>{String(r.gradeLabel ?? '')}</Td>
                  <Td numeric>{fmt(r.m3)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No batches" />
        )}
      </Card>

      <Card title="Material consumption" padded={false} actions={<ExportButton rows={consumption} columns={['material', 'consumed']} filename="material-consumption" />}>
        {!loaded ? (
          <TableSkeleton cols={2} />
        ) : consumption.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th numeric>Consumed</Th>
              </tr>
            </thead>
            <tbody>
              {consumption.map((c, i) => (
                <tr key={i}>
                  <Td>{String(c.material)}</Td>
                  <Td numeric>{fmt(c.consumed)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No consumption yet" />
        )}
      </Card>

      <Card title="Variance report (tolerance breaches)">
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : variance.length ? (
          variance.map((v, i) => (
            <div key={i} style={{ marginBottom: i < variance.length - 1 ? 16 : 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
                {String(v.batchTicketNo)} · {String(v.gradeLabel ?? '')} · {fmt(v.batchQuantityM3)} m³
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Material</Th>
                    <Th numeric>Target</Th>
                    <Th numeric>Actual</Th>
                    <Th numeric>Variance %</Th>
                    <Th numeric>Tol %</Th>
                  </tr>
                </thead>
                <tbody>
                  {((v.breaches as Row[]) ?? []).map((b, j) => (
                    <tr key={j}>
                      <Td>{String(b.material)}</Td>
                      <Td numeric>{fmt(b.target)}</Td>
                      <Td numeric>{fmt(b.actual)}</Td>
                      <Td numeric style={{ color: 'var(--mn-warning)', fontWeight: 600 }}>{String(b.variancePercentage)}%</Td>
                      <Td numeric>{String(b.tolerancePercentage)}%</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ))
        ) : (
          <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>No tolerance breaches.</p>
        )}
      </Card>
    </div>
  );
}
