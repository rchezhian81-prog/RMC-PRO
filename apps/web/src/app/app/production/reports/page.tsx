'use client';

import { useEffect, useState } from 'react';
import { productionReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function ProductionReportsPage() {
  const [byGrade, setByGrade] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [variance, setVariance] = useState<Row[]>([]);
  const [consumption, setConsumption] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [s, v, c] = await Promise.all([
        productionReportsApi.summary(),
        productionReportsApi.variance(),
        productionReportsApi.consumption(),
      ]);
      setByGrade(s.byGrade as Row[]);
      setTotals(s.totals as Row);
      setVariance(v);
      setConsumption(c);
    })()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Production Reports</h1>
      {error && <ErrorState message={error} />}

      <Card title={`Production summary${totals ? ` — ${fmt(totals.batches)} batches · ${fmt(totals.producedM3)} m³` : ''}`} padded={false}>
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

      <Card title="Material consumption" padded={false}>
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
